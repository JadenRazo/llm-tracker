// Read accepted benchmark rows for pages. A failed read is `unavailable`; a
// successful read with nothing collected yet is an empty list. Pages must not
// show "no results" for the first.

import { cache } from "react";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { tryGetDb, type Database } from "@/lib/db";
import { benchmarkSnapshots } from "@/lib/db/schema";
import { benchmarkRowSchema, type BenchmarkRow } from "./feeds";

export const BENCHMARK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface BenchmarkSourceState { source: string; rowCount: number; verifiedAt: string | null; publishedAt: string | null; error: string | null; status: "current" | "stale" | "failed" | "missing" }
export interface BenchmarkData {
  rows: BenchmarkRow[];
  sources: BenchmarkSourceState[];
  /** The read failed; nothing can be said about what exists. */
  unavailable: boolean;
}

export async function readBenchmarks(db: Database | null = tryGetDb(), now = Date.now()): Promise<BenchmarkData> {
  try {
    if (!db) throw new Error("No database");
    const ready = await db.execute<{ ready: boolean }>(sql`select to_regclass('benchmark_snapshots') is not null as ready`);
    if (!ready.rows[0]?.ready) return { rows: [], sources: [], unavailable: false };
    const snapshots = await db.select().from(benchmarkSnapshots);
    const rows: BenchmarkRow[] = [];
    const sources = snapshots.map((snapshot): BenchmarkSourceState => {
      const parsed = z.array(benchmarkRowSchema).safeParse(snapshot.rows);
      if (parsed.success) rows.push(...(parsed.data as BenchmarkRow[]));
      const verifiedAt = snapshot.verifiedAt?.toISOString() ?? null;
      return {
        source: snapshot.source, rowCount: parsed.success ? parsed.data.length : 0, verifiedAt, publishedAt: snapshot.publishedAt?.toISOString() ?? null, error: snapshot.error,
        status: !parsed.success || !snapshot.contentHash ? "missing" : snapshot.error ? "failed" : !verifiedAt || now - Date.parse(verifiedAt) >= BENCHMARK_MAX_AGE_MS ? "stale" : "current",
      };
    }).sort((a, b) => a.source.localeCompare(b.source));
    return { rows, sources, unavailable: false };
  } catch {
    return { rows: [], sources: [], unavailable: true };
  }
}
export const getBenchmarkData = cache(() => readBenchmarks());

/**
 * For /api/health and the poller's status op. The health route is probed every
 * few seconds, so this reads the scalar columns only and never the stored rows.
 */
export async function benchmarkHealth(db: Database, now = Date.now()) {
  try {
    const snapshots = await db.select({ source: benchmarkSnapshots.source, contentHash: benchmarkSnapshots.contentHash, rowCount: benchmarkSnapshots.rowCount, verifiedAt: benchmarkSnapshots.verifiedAt, error: benchmarkSnapshots.error }).from(benchmarkSnapshots);
    const sources = snapshots.map((s) => ({
      source: s.source, rowCount: s.rowCount, verifiedAt: s.verifiedAt?.toISOString() ?? null, error: s.error,
      status: !s.contentHash ? "missing" : s.error ? "failed" : !s.verifiedAt || now - s.verifiedAt.getTime() >= BENCHMARK_MAX_AGE_MS ? "stale" : "current",
    })).sort((a, b) => a.source.localeCompare(b.source));
    return { ok: sources.length > 0 && sources.every((s) => s.status === "current"), sources };
  } catch {
    // Before the deployment migration the table does not exist yet.
    return { ok: false, sources: [], reason: "Benchmark state unavailable" };
  }
}
