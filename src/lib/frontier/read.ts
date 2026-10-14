import { cache } from "react";
import { desc, inArray, or, sql } from "drizzle-orm";
import { tryGetDb, type Database } from "@/lib/db";
import { frontierRevisions, frontierStates } from "@/lib/db/schema";
import { FRONTIER_MODELS, FRONTIER_REVIEWED_AT, type FrontierModel } from "@/lib/frontier-models";
import { frontierFactsSchema, frontierProviders, type FrontierRevision, type FrontierState } from "./schema";
import { presentFrontier } from "./presentation";

export interface FrontierData { current: FrontierModel[]; available: FrontierModel[]; unavailable: boolean; missingIds: string[] }
export function requestedModelIds(raw = ""): string[] { return [...new Set(raw.split(",").filter((v) => /^(?:claude|gpt|gemini)-[a-z0-9.-]{1,90}$/.test(v)))].slice(0,3); }
export async function readFrontier(raw = "", db: Database | null = tryGetDb()): Promise<FrontierData> {
  const ids = requestedModelIds(raw);
  const fallbacks = FRONTIER_MODELS.map((m) => ({ ...m, verifiedAt: `${FRONTIER_REVIEWED_AT}T00:00:00Z`, freshness: "fallback" as const, freshnessNote: "Automatic data is unavailable. Showing the dated bundled profile; check the official source for changes." }));
  try {
    if (!db) throw new Error("No database");
    // One transaction gives every page a consistent selection and revision set.
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      const states = await tx.select().from(frontierStates);
      const selected = states.map((s) => s.revisionId).filter((s): s is string => !!s);
      const rows = selected.length || ids.length ? await tx.select({ id: frontierRevisions.id, facts: frontierRevisions.facts, verifiedAt: frontierRevisions.verifiedAt }).from(frontierRevisions)
        .where(or(selected.length ? inArray(frontierRevisions.id, selected) : undefined, ids.length ? inArray(frontierRevisions.modelId, ids) : undefined))
        .orderBy(desc(frontierRevisions.verifiedAt)) : [];
      const stateFor = (provider: string): FrontierState | undefined => {
        const s = states.find((v) => v.provider === provider);
        return s ? { provider: s.provider as FrontierState["provider"], revisionId: s.revisionId, attemptedAt: s.attemptedAt?.toISOString() ?? null, error: s.error, paused: s.paused } : undefined;
      };
      const parsed = rows.map((row): FrontierRevision => ({ id: row.id, facts: frontierFactsSchema.parse(row.facts), verifiedAt: row.verifiedAt.toISOString() }));
      const current = frontierProviders.map((provider, i) => {
        const state = stateFor(provider), revision = parsed.find((r) => r.id === state?.revisionId && r.facts.provider === provider);
        return revision ? presentFrontier(revision, state) : fallbacks[i];
      });
      const available = [...current];
      for (const id of ids) {
        if (available.some((m) => m.id === id)) continue;
        const revision = parsed.find((r) => r.facts.id === id);
        if (revision) available.push(presentFrontier(revision, stateFor(revision.facts.provider)));
        else { const fallback = fallbacks.find((m) => m.id === id); if (fallback) available.push({ ...fallback, freshness: "archived" }); }
      }
      return { current, available, unavailable: false, missingIds: ids.filter((id) => !available.some((m) => m.id === id)) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  } catch {
    return { current: fallbacks, available: fallbacks, unavailable: true, missingIds: ids.filter((id) => !fallbacks.some((m) => m.id === id)) };
  }
}
export const getFrontierData = cache((raw = "") => readFrontier(raw));

