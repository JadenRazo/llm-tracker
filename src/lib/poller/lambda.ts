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
import { runSource, type SourceKey } from "./runner";

interface PollerEvent {
  /** Optional override, mainly for a manual `aws lambda invoke` smoke test. */
  tier?: number;
  /** Optional single-source override, same use case. */
  source?: string;
}

export interface PollerResult {
  tier: number;
  ok: number;
  err: number;
  ms: number;
  sources: Array<{ source: string; status: string; inserted: number; updated: number; skipped: number; error?: string }>;
}

function resolveTier(event: PollerEvent | undefined): SourceTier {
  const raw = event?.tier ?? Number(process.env.TIER);
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  throw new Error(
    `poller: TIER must be 1, 2 or 3 (got ${JSON.stringify(process.env.TIER)}); refusing to guess`,
  );
}

export async function handler(event?: PollerEvent): Promise<PollerResult> {
  const tier = resolveTier(event);

  const keys: SourceKey[] = event?.source
    ? [event.source as SourceKey]
    : sourcesForTier(tier).map((d) => d.key);

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
