// Refresh one benchmark feed. Runs inside the existing tier-3 poller.
//
// The network and parsing happen before any transaction, under one deadline, so
// a slow publisher cannot hold a database connection that the frontier sources
// need. Publication is all-or-nothing and keyed by a hash of the parsed rows:
// an unchanged feed moves only `verified_at`, and a feed the parser cannot
// vouch for leaves the last accepted rows in place.

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";
import { benchmarkSnapshots } from "@/lib/db/schema";
import type { RunResult } from "@/lib/poller/runner";
import { parseArcPrize, parseEpochArchive, type BenchmarkRow } from "./feeds";

export const BENCHMARK_SOURCES = ["benchmarks_epoch", "benchmarks_arcprize"] as const;
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number];

/** The only URLs these sources may fetch. Redirects are refused. */
export const BENCHMARK_URLS = {
  epochArchive: "https://epoch.ai/data/benchmark_data.zip",
  arcEvaluations: "https://arcprize.org/media/data/evaluations.json",
  arcModels: "https://arcprize.org/media/data/models.json",
} as const;

/**
 * Bump when parsing changes what a row says. A stored validator is tagged with
 * the version that parsed its body, so "304 Not Modified" can never keep rows
 * that an older parser produced.
 */
export const BENCHMARK_PARSER_VERSION = "2026-11-17.2";
const tagged = (etag: string | null) => (etag ? `${BENCHMARK_PARSER_VERSION} ${etag}` : null);
const untagged = (stored: string | null | undefined) => (stored?.startsWith(`${BENCHMARK_PARSER_VERSION} `) ? stored.slice(BENCHMARK_PARSER_VERSION.length + 1) : null);

const MAX_BYTES = 12 * 1024 * 1024;
const DEADLINE_MS = 60_000;

/** The publisher is unreachable or busy: nothing is wrong with the data we hold. */
export class UpstreamUnavailable extends Error {}

interface Fetched { status: 200; bytes: Uint8Array; etag: string | null }
async function fetchBounded(url: string, deadline: number, fetcher: typeof fetch, etag?: string | null): Promise<Fetched | { status: 304 }> {
  const headers: Record<string, string> = { "User-Agent": "llm-tracker/0.1 (+https://llm.raizhost.com)" };
  if (etag) headers["If-None-Match"] = etag;
  let response: Response;
  try {
    response = await fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))) });
  } catch (error) {
    throw new UpstreamUnavailable(`Could not reach ${new URL(url).hostname}: ${error instanceof Error ? error.name : "network error"}`);
  }
  if (response.status === 304 && etag) return { status: 304 };
  if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new UpstreamUnavailable(`${new URL(url).hostname} returned HTTP ${response.status}`); }
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`); }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("Benchmark data exceeds the size limit"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Benchmark data has no body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Benchmark data exceeds the size limit"); }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof Error && /size limit/.test(error.message)) throw error;
    throw new UpstreamUnavailable(`Reading ${new URL(url).hostname} was interrupted`);
  } finally { reader.releaseLock(); }
  return { status: 200, bytes: Buffer.concat(chunks), etag: response.headers.get("etag") };
}

/** Fetch and parse one source. Returns null when the publisher says nothing changed. */
export async function extractBenchmarks(source: BenchmarkSource, etag: string | null, fetcher: typeof fetch = fetch): Promise<{ rows: BenchmarkRow[]; etag: string | null } | null> {
  const deadline = Date.now() + DEADLINE_MS;
  if (source === "benchmarks_epoch") {
    const archive = await fetchBounded(BENCHMARK_URLS.epochArchive, deadline, fetcher, etag);
    if (archive.status === 304) return null;
    return { rows: parseEpochArchive(archive.bytes), etag: archive.etag };
  }
  // Two documents that must agree, so neither is fetched conditionally.
  const [evaluations, models] = await Promise.all([fetchBounded(BENCHMARK_URLS.arcEvaluations, deadline, fetcher), fetchBounded(BENCHMARK_URLS.arcModels, deadline, fetcher)]);
  if (evaluations.status !== 200 || models.status !== 200) throw new Error("Unexpected conditional response");
  const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");
  return { rows: parseArcPrize(text(evaluations.bytes), text(models.bytes)), etag: null };
}

export const rowsHash = (rows: readonly BenchmarkRow[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const diagnostic = (error: unknown) => (error instanceof Error && !("query" in error) ? error.message : "Benchmark refresh failed").replace(/[^\x20-\x7E]/g, "?").slice(0, 300);

export async function syncBenchmarks(source: BenchmarkSource, db: Database = getDb(), fetcher: typeof fetch = fetch): Promise<RunResult> {
  const started = new Date();
  // New pollers may run briefly before the explicit deployment migration.
  const ready = await db.execute<{ ready: boolean }>(sql`select to_regclass('benchmark_snapshots') is not null as ready`);
  if (!ready.rows[0]?.ready) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  const [previous] = await db.select({ contentHash: benchmarkSnapshots.contentHash, rowCount: benchmarkSnapshots.rowCount, etag: benchmarkSnapshots.etag }).from(benchmarkSnapshots).where(eq(benchmarkSnapshots.source, source));

  const fail = async (message: string) => {
    await db.insert(benchmarkSnapshots).values({ source, attemptedAt: started, error: message })
      .onConflictDoUpdate({ target: benchmarkSnapshots.source, set: { attemptedAt: started, error: message } });
  };

  let extracted: Awaited<ReturnType<typeof extractBenchmarks>>;
  try {
    // A stored validator is only usable while the rows it described are still held.
    extracted = await extractBenchmarks(source, previous?.contentHash ? untagged(previous.etag) : null, fetcher);
  } catch (error) {
    await fail(diagnostic(error));
    // An unreachable publisher is not a defect here. It is recorded and shows as
    // stale if it lasts; a document we cannot parse is an error straight away.
    if (error instanceof UpstreamUnavailable) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
    throw new Error(diagnostic(error));
  }

  if (extracted === null) {
    await db.update(benchmarkSnapshots).set({ verifiedAt: started, attemptedAt: started, error: null }).where(eq(benchmarkSnapshots.source, source));
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged" };
  }
  const rows = extracted.rows, etag = tagged(extracted.etag), contentHash = rowsHash(rows);
  if (previous?.contentHash === contentHash) {
    await db.update(benchmarkSnapshots).set({ verifiedAt: started, attemptedAt: started, error: null, etag }).where(eq(benchmarkSnapshots.source, source));
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", lastSeenHash: contentHash };
  }
  // A feed that suddenly loses most of its rows has more likely changed shape
  // than retracted its results. Keep what we have and ask for a look.
  if (previous?.rowCount && rows.length < previous.rowCount / 2) {
    const message = `Feed shrank from ${previous.rowCount} to ${rows.length} rows; kept the previous results`;
    await fail(message);
    throw new Error(message);
  }
  const accepted = { contentHash, rows, rowCount: rows.length, etag, publishedAt: started, verifiedAt: started, attemptedAt: started, error: null };
  await db.insert(benchmarkSnapshots).values({ source, ...accepted }).onConflictDoUpdate({ target: benchmarkSnapshots.source, set: accepted });
  return { inserted: previous?.contentHash ? 0 : rows.length, updated: previous?.contentHash ? rows.length : 0, skipped: 0, status: "ok", lastSeenHash: contentHash };
}
