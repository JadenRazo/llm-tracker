import { sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";

/** Fixed additive migration, called explicitly by deployment, never by a page. */
export async function migrateFrontier(db: Database = getDb()) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(807131, 0)`);
    await tx.execute(sql`create table if not exists frontier_documents (
      url text primary key, provider text not null, body text not null,
      hash text not null, etag text, last_modified text,
      fetched_at timestamptz not null default now()
    )`);
    await tx.execute(sql`create table if not exists frontier_revisions (
      id text primary key, provider text not null, model_id text not null,
      facts jsonb not null, evidence jsonb not null,
      accepted_at timestamptz not null default now(),
      verified_at timestamptz not null default now()
    )`);
    await tx.execute(sql`create index if not exists frontier_revisions_model_idx
      on frontier_revisions(provider, model_id, verified_at)`);
    await tx.execute(sql`create table if not exists frontier_states (
      provider text primary key, revision_id text references frontier_revisions(id),
      attempted_at timestamptz, error text, paused boolean not null default false
    )`);
  });
  return { ok: true, migration: "frontier-v1" };
}
