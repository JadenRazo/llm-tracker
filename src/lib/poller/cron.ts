// node-cron scheduler — registered once at boot by `src/instrumentation.ts`.
//
// Three tiers, rationale in /root/.claude/plans/is-it-possible-for-noble-penguin.md:
//   T1 every 10m: cheap, time-sensitive
//   T2 every 30m: medium-weight
//   T3 every  2h: HTML scrapes
//
// Sources within a tier run in parallel (`Promise.allSettled`) — they share no
// in-flight state and serializing them stacked their wall times. Per-tier
// singleflight guard prevents the next cron tick from racing a still-running
// run (matters most for T3, where mcp_servers can take >30s).

import cron from "node-cron";
import { sourcesForTier } from "@/lib/sources/registry";
import { runSource, type SourceKey } from "./runner";

// Tiers are derived from the registry — registry order within a tier is
// preserved, so the fan-out (and boot-kick stagger) is identical to the
// pre-refactor hardcoded arrays.
const TIER_1: SourceKey[] = sourcesForTier(1).map((d) => d.key);
const TIER_2: SourceKey[] = sourcesForTier(2).map((d) => d.key);
const TIER_3: SourceKey[] = sourcesForTier(3).map((d) => d.key);

const inFlight = new Map<string, Promise<void>>();

async function runTier(label: string, sources: SourceKey[]): Promise<void> {
  const existing = inFlight.get(label);
  if (existing) {
    // eslint-disable-next-line no-console
    console.warn(`[cron:${label}] skipped — previous run still in flight`);
    return existing;
  }

  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[cron:${label}] start (${sources.length} source${sources.length === 1 ? "" : "s"})`);

  const work = (async () => {
    try {
      const results = await Promise.allSettled(
        sources.map(async (key) => {
          const result = await runSource(key);
          return { key, result };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          const { key, result } = r.value;
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              level: "info",
              tier: label,
              source: key,
              inserted: result.inserted,
              updated: result.updated,
              skipped: result.skipped,
              status: result.status ?? (result.error ? "error" : "ok"),
              ...(result.error ? { error: result.error } : {}),
            }),
          );
        } else {
          // runSource itself catches; this only fires if the wrapper above throws.
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({ level: "error", tier: label, error: String(r.reason) }));
        }
      }
    } finally {
      // eslint-disable-next-line no-console
      console.log(`[cron:${label}] done in ${Date.now() - startedAt}ms`);
      inFlight.delete(label);
    }
  })();

  inFlight.set(label, work);
  return work;
}

let _started = false;

export function startCron(): void {
  if (_started) return;
  _started = true;

  cron.schedule("*/10 * * * *", () => void runTier("T1", TIER_1));
  cron.schedule("*/30 * * * *", () => void runTier("T2", TIER_2));
  cron.schedule("0 */2 * * *", () => void runTier("T3", TIER_3));

  // Boot kicks — staggered so we don't fan out every fetch simultaneously.
  setTimeout(() => void runTier("T1-boot", TIER_1), 5_000);
  setTimeout(() => void runTier("T2-boot", TIER_2), 20_000);
  setTimeout(() => void runTier("T3-boot", TIER_3), 40_000);

  // eslint-disable-next-line no-console
  console.log("[cron] scheduler started (T1: 10m, T2: 30m, T3: 2h, parallel within tier)");
}
