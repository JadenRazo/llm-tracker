import { sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";

/**
 * Fixed additive migration for benchmark results, called explicitly by
 * deployment and never by a page. One row per source: the accepted rows and
 * the outcome of the latest attempt travel together.
 */
export async function migrateBenchmarks(db: Database = getDb()) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(807132, 0)`);
    await tx.execute(sql`create table if not exists benchmark_snapshots (
      source text primary key,
      content_hash text,
      rows jsonb not null default '[]'::jsonb,
      row_count integer not null default 0,
      etag text,
      published_at timestamptz,
      verified_at timestamptz,
      attempted_at timestamptz,
      error text
    )`);
  });
  return { ok: true, migration: "benchmarks-v1" };
}
