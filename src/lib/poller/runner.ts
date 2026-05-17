// Source dispatcher: given a SourceKey, run the matching registry descriptor
// and record the outcome in poller_runs.
//
// The source set is the provider-keyed registry in src/lib/sources/registry.ts.
// `SourceKey` is derived from that registry — adding a source there extends the
// union automatically. `RunResult` lives here (every source imports the type
// from this module); the registry imports the run functions, never this file's
// runtime, so there is no import cycle (the source modules' `RunResult` import
// is type-only and erased at compile time).

import { tryGetDb } from "@/lib/db";
import { pollerRuns } from "@/lib/db/schema";
import { getSourceDescriptor, SOURCE_REGISTRY } from "@/lib/sources/registry";

/** Every persisted source key, derived from the registry. */
export type SourceKey = (typeof SOURCE_REGISTRY)[number]["key"];

export interface RunResult {
  inserted: number;
  updated: number;
  skipped: number;
  /** "ok" | "unchanged" | "skipped" — anything that isn't a thrown error. */
  status?: "ok" | "unchanged" | "skipped";
  etag?: string;
  lastModified?: string;
  lastSeenHash?: string;
}

export function isSourceKey(key: string): key is SourceKey {
  return getSourceDescriptor(key) !== undefined;
}

/**
 * Run a single source, wrapped with a poller_runs bookkeeping row.
 * Never throws — errors are captured and persisted.
 */
export async function runSource(key: SourceKey): Promise<RunResult & { error?: string }> {
  const startedAt = new Date();
  const db = tryGetDb();

  try {
    const descriptor = getSourceDescriptor(key);
    if (!descriptor) throw new Error(`unknown source: ${key}`);
    const result = await descriptor.run();
    const finishedAt = new Date();

    if (db) {
      await db.insert(pollerRuns).values({
        source: key,
        status: result.status ?? "ok",
        startedAt,
        finishedAt,
        etag: result.etag,
        lastModified: result.lastModified,
        lastSeenHash: result.lastSeenHash,
      });
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    if (db) {
      try {
        await db.insert(pollerRuns).values({
          source: key,
          status: "error",
          startedAt,
          finishedAt,
          error: message.slice(0, 2000),
        });
      } catch {
        // swallow — DB may be down, and we already have the original error to report
      }
    }
    // eslint-disable-next-line no-console
    console.error(`[poller] ${key} failed:`, message);
    return { inserted: 0, updated: 0, skipped: 0, error: message };
  }
}
