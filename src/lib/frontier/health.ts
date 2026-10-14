import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { frontierRevisions, frontierStates } from "@/lib/db/schema";
import { frontierFactsSchema, frontierProviders } from "./schema";

export async function frontierHealth(db: Database) {
  const states = await db.select().from(frontierStates);
  const results = [];
  for (const provider of frontierProviders) {
    const state = states.find((s) => s.provider === provider);
    const [row] = state?.revisionId ? await db.select({ id: frontierRevisions.id, facts: frontierRevisions.facts, verifiedAt: frontierRevisions.verifiedAt }).from(frontierRevisions).where(and(eq(frontierRevisions.id, state.revisionId), eq(frontierRevisions.provider, provider))) : [];
    const parsed = row ? frontierFactsSchema.safeParse(row.facts) : null;
    const ageSeconds = row ? Math.round((Date.now() - row.verifiedAt.getTime()) / 1000) : null;
    results.push({ provider, modelId: parsed?.success ? parsed.data.id : null, revisionId: row?.id ?? null, verifiedAt: row?.verifiedAt.toISOString() ?? null, ageSeconds,
      sourceHashes: parsed?.success ? parsed.data.sources.map((s) => ({ url: s.url, hash: s.hash })) : [],
      status: !parsed?.success ? "missing" : state?.paused ? "paused" : state?.error ? "failed" : ageSeconds !== null && ageSeconds >= 6 * 3600 ? "stale" : "current",
      error: state?.error ?? null });
  }
  return { ok: results.every((r) => r.status === "current"), providers: results };
}
