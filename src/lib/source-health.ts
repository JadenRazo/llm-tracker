// Which sources have stopped reading their upstream. Kept out of the route
// file because a Next.js route module may only export handlers and config.

import { SOURCE_REGISTRY } from "@/lib/sources/registry";

export interface SourceState extends Record<string, unknown> {
  source: string;
  status: string;
  startedAt: string | Date;
  /** Newest run that actually read its source ("ok" or "unchanged"), if recent. */
  lastGoodAt: string | Date | null;
}

/** Seconds between scheduled runs of each tier; three missed runs is stale. */
const TIER_CADENCE_SECONDS = { 1: 600, 2: 1800, 3: 7200 } as const;
const STALE_AFTER_RUNS = 3;
/** The widest stale window (tier 3), which bounds the last-good lookup. */
export const LAST_GOOD_LOOKBACK_SECONDS = TIER_CADENCE_SECONDS[3] * STALE_AFTER_RUNS;

/**
 * Sources whose last successful read is older than three scheduled runs, or
 * that have none in the lookback window. A source that keeps running but only
 * records "skipped" or "error" is stale; one that has never run is not listed
 * here (the caller reports it as never run).
 */
export function staleSources(rows: readonly SourceState[], now: number, registry: readonly { key: string; tier: 1 | 2 | 3 }[] = SOURCE_REGISTRY): string[] {
  return registry.filter((d) => {
    const row = rows.find((r) => r.source === d.key);
    if (!row) return false;
    const lastGood = row.lastGoodAt ? new Date(row.lastGoodAt).getTime() : null;
    // An unreadable timestamp is not evidence of a successful read.
    return lastGood === null || !Number.isFinite(lastGood) || now - lastGood >= TIER_CADENCE_SECONDS[d.tier] * STALE_AFTER_RUNS * 1000;
  }).map((d) => d.key).sort();
}
