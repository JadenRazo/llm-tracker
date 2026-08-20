// AWS Lambda entrypoint for the three scheduled poller functions
// (raizcloud-claude-tracker-poller-t1 / -t2 / -t3).
//
// WHY THIS FILE EXISTS
// -------------------
// Until now the poller Lambdas had NO deploy path in this repository. They were
// three hand-uploaded zips (nodejs22.x, arm64, `index.handler`, identical
// 684,294-byte artifact, tier chosen by the TIER env var) last modified
// 2026-06-22, while `deploy.yml` only ever updated the web container image. The
// ingest half of a tracker — the half that makes it a tracker — was running code
// nobody could point at, and every source fix in this repo was undeliverable.
//
// This module reproduces the deployed contract exactly (same handler name, same
// TIER env var, same per-source JSON log lines) and `deploy.yml` now bundles and
// ships it alongside the web image, so the pollers and the site can never again
// drift onto different source trees.
//
// The in-process node-cron scheduler (`src/lib/poller/cron.ts`) is the local /
// docker-compose path and stays as it is; on Lambda `DISABLE_CRON=1` and
// EventBridge owns the cadence.

import { sourcesForTier, type SourceTier } from "@/lib/sources/registry";
import { isSourceKey, runSource, type SourceKey } from "./runner";

/**
 * Sources per tier, derived from the registry at build time. `build-poller.mjs`
 * reads this off the bundle and writes it beside the zip so the deploy's
 * assertion is generated from the same source of truth that ships, instead of a
 * hand-maintained map that silently goes stale the first time a source is added
 * (adding `openai_models` to tier 3 failed a deploy for exactly that reason).
 */
export const TIER_SOURCE_COUNTS: Record<number, number> = {
  1: sourcesForTier(1).length,
  2: sourcesForTier(2).length,
  3: sourcesForTier(3).length,
};

interface PollerEvent {
  /** Optional override, mainly for a manual `aws lambda invoke` smoke test. */
  tier?: number;
  /**
   * Optional single-source override, same use case.
   *
   * Deliberately NOT named `source`: EventBridge and EventBridge Scheduler put
   * their own `source` field in the event envelope (`"aws.scheduler"`), so a
   * `source` override silently consumed it — every scheduled tick ran one
   * "source" called `aws.scheduler`, failed with `unknown source`, and skipped
   * the whole tier. Anything read off the event must be a name AWS does not
   * already use, and must be validated before it reaches the runner.
   */
  sourceKey?: string;
}

export interface PollerResult {
  tier: number;
  ok: number;
  err: number;
  ms: number;
  sources: Array<{ source: string; status: string; inserted: number; updated: number; skipped: number; error?: string }>;
}

function resolveTier(event: PollerEvent | undefined): SourceTier {
  // Only an explicitly numeric `tier` overrides the env var — an AWS event
  // envelope must never be able to steer this by accident.
  const raw = typeof event?.tier === "number" ? event.tier : Number(process.env.TIER);
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  throw new Error(
    `poller: TIER must be 1, 2 or 3 (got ${JSON.stringify(process.env.TIER)}); refusing to guess`,
  );
}

export async function handler(event?: PollerEvent): Promise<PollerResult> {
  const tier = resolveTier(event);

  let keys: SourceKey[];
  if (typeof event?.sourceKey === "string") {
    if (!isSourceKey(event.sourceKey)) {
      throw new Error(
        `poller: unknown sourceKey ${JSON.stringify(event.sourceKey)} — refusing to run`,
      );
    }
    keys = [event.sourceKey];
  } else {
    keys = sourcesForTier(tier).map((d) => d.key);
  }

  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "tier start", tier, sources: keys.length }));

  // Sources share no in-flight state, and serializing them stacked their wall
  // times past the function timeout on T2 (15 sources).
  const settled = await Promise.allSettled(
    keys.map(async (key) => ({ key, result: await runSource(key) })),
  );

  const sources: PollerResult["sources"] = [];
  let ok = 0;
  let err = 0;

  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      const { key, result } = entry.value;
      const status = result.error ? "error" : (result.status ?? "ok");
      if (result.error) err++;
      else ok++;
      sources.push({
        source: key,
        status,
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        ...(result.error ? { error: result.error } : {}),
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          level: result.error ? "error" : "info",
          tier,
          source: key,
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          ...(result.error ? { error: result.error } : {}),
        }),
      );
    } else {
      // runSource catches its own errors, so this only fires if the wrapper threw.
      err++;
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ level: "error", tier, error: String(entry.reason) }));
    }
  }

  const ms = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "tier done", tier, ok, err, ms }));

  return { tier, ok, err, ms, sources };
}
