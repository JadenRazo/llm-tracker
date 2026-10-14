import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";
import { frontierDocuments, frontierRevisions, frontierStates } from "@/lib/db/schema";
import type { RunResult } from "@/lib/poller/runner";
import { documentHash, documentReader, type DocumentStore } from "./fetch-document";
import { parseFrontier, requiredDocuments, selectCandidate } from "./parsers";
import { LINEUPS, frontierProviders, type FrontierFacts, type FrontierProvider, type SourceDocument } from "./schema";

function diagnostic(error: unknown): string {
  // Drizzle errors embed SQL parameters, including complete evidence bodies.
  if (error instanceof Error && ("query" in error || error.message.startsWith("Failed query:"))) {
    const cause = error.cause as { code?: unknown } | undefined;
    const code = typeof cause?.code === "string" && /^[A-Z0-9]{5}$/.test(cause.code) ? ` (${cause.code})` : "";
    return `Database publication failed${code}`;
  }
  return (error instanceof Error ? error.message : "Frontier refresh failed").slice(0, 500);
}

export async function extractFrontier(provider: FrontierProvider, store: DocumentStore, fetcher: typeof fetch = fetch): Promise<{ facts: FrontierFacts; documents: SourceDocument[] }> {
  const read = documentReader(provider, store, fetcher);
  const index = await read(LINEUPS[provider]);
  const candidate = selectCandidate(provider, index.body);
  const documents = [index];
  const urls = requiredDocuments(provider, candidate);
  // At most two HTTP requests in flight per provider, six across the tier.
  for (let i = 0; i < urls.length; i += 2) {
    const results = await Promise.allSettled(urls.slice(i, i + 2).map(read));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      documents.push(result.value);
    }
  }
  return { facts: parseFrontier(provider, candidate, documents), documents };
}

export async function syncFrontier(provider: FrontierProvider, db: Database = getDb(), fetcher: typeof fetch = fetch): Promise<RunResult> {
  const started = new Date();
  // New handlers may run briefly before the explicit deployment migration.
  const ready = await db.execute<{ ready: boolean }>(sql`select to_regclass('frontier_states') is not null and to_regclass('frontier_revisions') is not null and to_regclass('frontier_documents') is not null as ready`);
  if (!ready.rows[0]?.ready) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    const lock = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(807131, ${frontierProviders.indexOf(provider) + 1}) as acquired`);
    if (!lock.rows[0]?.acquired) return { skipped: true };
    const [state] = await tx.select().from(frontierStates).where(eq(frontierStates.provider, provider));
    if (state?.paused) return { error: "Automatic refresh paused for recovery" };
    if (state?.attemptedAt && state.attemptedAt >= started) return { skipped: true };
    const store: DocumentStore = {
      async load(url) {
        const [row] = await tx.select().from(frontierDocuments).where(and(eq(frontierDocuments.url, url), eq(frontierDocuments.provider, provider)));
        return row ? { url: row.url, body: row.body, hash: row.hash, etag: row.etag ?? undefined, lastModified: row.lastModified ?? undefined } : null;
      },
      async save(document) {
        const value = { ...document, provider, fetchedAt: new Date(), etag: document.etag ?? null, lastModified: document.lastModified ?? null };
        await tx.insert(frontierDocuments).values(value).onConflictDoUpdate({ target: frontierDocuments.url, set: value });
        await tx.execute(sql`delete from frontier_documents where provider = ${provider} and url not in (
          select url from frontier_documents where provider = ${provider} order by fetched_at desc, url limit 8
        )`);
      },
    };
    try {
      const { facts, documents } = await extractFrontier(provider, store, fetcher);
      const revisionId = documentHash(JSON.stringify(facts));
      const verifiedAt = new Date();
      await tx.insert(frontierRevisions).values({ id: revisionId, provider, modelId: facts.id, facts, evidence: documents, acceptedAt: verifiedAt, verifiedAt })
        .onConflictDoUpdate({ target: frontierRevisions.id, set: { verifiedAt } });
      await tx.insert(frontierStates).values({ provider, revisionId, attemptedAt: started, error: null })
        .onConflictDoUpdate({ target: frontierStates.provider, set: { revisionId, attemptedAt: started, error: null } });
      // Three accepted revisions per model; never remove a selected revision.
      await tx.execute(sql`delete from frontier_revisions where id in (
        select id from (select id, row_number() over (partition by model_id order by verified_at desc, accepted_at desc, id) as n
          from frontier_revisions where provider = ${provider}) ranked where n > 3
        ) and id not in (select revision_id from frontier_states where revision_id is not null)`);
      // Discard cache URLs no longer used by this provider. Accepted revisions
      // retain their own immutable bodies, including historical model evidence.
      await tx.execute(sql`delete from frontier_documents where provider = ${provider}
        and url not in (${sql.join(documents.map((d) => sql`${d.url}`), sql`, `)})`);
      return { revisionId };
    } catch (error) {
      const message = diagnostic(error);
      await tx.insert(frontierStates).values({ provider, attemptedAt: started, error: message })
        .onConflictDoUpdate({ target: frontierStates.provider, set: { attemptedAt: started, error: message } });
      return { error: message };
    }
  }).catch(async (error: unknown) => {
    // SQL errors abort the publication transaction. Record the failed attempt
    // in a NEW transaction, without overwriting a newer completed refresh.
    const message = diagnostic(error);
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(807131, ${frontierProviders.indexOf(provider) + 1})`);
        await tx.insert(frontierStates).values({ provider, attemptedAt: started, error: message })
          .onConflictDoUpdate({ target: frontierStates.provider, set: { attemptedAt: started, error: message }, setWhere: sql`${frontierStates.attemptedAt} is null or ${frontierStates.attemptedAt} <= ${started.toISOString()}::timestamptz` });
      });
    } catch { /* runner still records the original failure; deployment checks it */ }
    throw new Error(`${provider} frontier: ${message}`);
  });
  if (outcome.error) throw new Error(`${provider} frontier: ${outcome.error}`);
  return { inserted: 0, updated: outcome.skipped ? 0 : 1, skipped: 0, status: outcome.skipped ? "unchanged" : "ok" };
}

/** Explicit administrative recovery only. Pausing prevents immediate republish. */
export async function restoreFrontier(provider: FrontierProvider, revisionId: string, db: Database = getDb()) {
  if (!frontierProviders.includes(provider) || !/^[a-f0-9]{64}$/.test(revisionId)) throw new Error("Invalid frontier recovery request");
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(807131, ${frontierProviders.indexOf(provider) + 1})`);
    const [revision] = await tx.select({ id: frontierRevisions.id }).from(frontierRevisions).where(and(eq(frontierRevisions.id, revisionId), eq(frontierRevisions.provider, provider)));
    if (!revision) throw new Error("Accepted revision not found for this provider");
    await tx.update(frontierStates).set({ revisionId, paused: true, error: "Prior accepted revision restored; automatic refresh paused" }).where(eq(frontierStates.provider, provider));
  });
  return { ok: true, provider, revisionId, paused: true };
}
