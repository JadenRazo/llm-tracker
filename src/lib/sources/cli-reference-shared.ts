// Shared safety rails for the three cli_reference sources (Claude / OpenAI / Gemini).
//
// Each source keeps a per-provider slice of the `cli_reference` table fresh and
// runs a "deprecation sweep": a row whose lastSeenAt has gone stale is presumed
// removed upstream, flagged `deprecated_at`, and hidden from the site (every page
// that reads cli_reference filters on `deprecated_at is null`).
//
// That sweep is only sound when the run actually SAW the upstream document. Two
// ways it went wrong in production:
//
//   1. The Claude sweep was not scoped by provider, so it flagged the OpenAI and
//      Gemini slices too — all 481 OpenAI rows and all 40 Gemini rows ended up
//      deprecated and invisible on the site.
//   2. A source that gets a 304 (or whose fetch fails) parses zero items, so
//      EVERY one of its rows looks stale. Left unguarded, one quiet upstream
//      would erase that provider's whole reference section.

import { and, eq } from "drizzle-orm";
import { cliReference } from "@/lib/db/schema";
import type { Database } from "@/lib/db";
import type { Provider } from "@/lib/providers";

/**
 * A 304 means the upstream document is byte-identical to the one we last parsed,
 * so every row we derived from it is still present. Touch this provider's rows
 * so the next partial run can't mistake them for removed, and clear any
 * deprecation a previous defect left behind.
 */
export async function markProviderRowsStillPresent(
  db: Database,
  provider: Provider,
  now: Date,
): Promise<void> {
  await db
    .update(cliReference)
    .set({ lastSeenAt: now, deprecatedAt: null })
    .where(eq(cliReference.provider, provider));
}

/**
 * Guard for the deprecation sweep: never deprecate anything on a run that parsed
 * nothing. "We saw no items" is not evidence that items disappeared.
 */
export function sweepIsSafe(parsedCount: number): boolean {
  return parsedCount > 0;
}

/** Re-exported so call sites read consistently. */
export { and, eq };
