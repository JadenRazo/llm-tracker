// Every tracked model, not only the one verified pick per provider.
//
// The frontier layer profiles a single model per lab. When a lab launches two
// models at once (GPT-6.2 Astra and GPT-6.2 Sol), the second is in the catalog
// within one poll but had no page and could not be linked to. This module reads
// the catalog row so every tracked model resolves to something.

import { eq } from "drizzle-orm";
import { tryGetDb, type Database } from "@/lib/db";
import { models, type Model } from "@/lib/db/schema";
import { isProvider, type Provider } from "@/lib/providers";

/**
 * Shape of a catalog model ID. Catalog IDs are the provider's own slug, so they
 * are not limited to the `claude-` / `gpt-` / `gemini-` prefixes (`o3`,
 * `text-embedding-3-large`). Existence is decided by the database.
 */
export const CATALOG_MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,99}$/;

export const LABS: Record<Provider, string> = { claude: "Anthropic", openai: "OpenAI", gemini: "Google DeepMind" };

/** The official page to check a catalog fact against. */
export function officialModelPage(provider: Provider, id: string): { label: string; url: string } {
  if (provider === "openai") return { label: "OpenAI model page", url: `https://developers.openai.com/api/docs/models/${id}` };
  if (provider === "gemini") return { label: "Gemini API model page", url: `https://aistudio.google.com/docs/models/${id}` };
  return { label: "Claude model lineup", url: "https://platform.claude.com/docs/en/models/overview" };
}

export interface CatalogModel extends Omit<Model, "provider"> { provider: Provider }
export interface CatalogLookup {
  /** The row, or null when the catalog has no such model. */
  model: CatalogModel | null;
  /** True when the read failed. A failed read is never reported as "not found". */
  unavailable: boolean;
}

export async function readCatalogModel(id: string, db: Database | null = tryGetDb()): Promise<CatalogLookup> {
  if (!CATALOG_MODEL_ID.test(id)) return { model: null, unavailable: false };
  if (!db) return { model: null, unavailable: true };
  try {
    const [row] = await db.select().from(models).where(eq(models.id, id)).limit(1);
    if (!row || !isProvider(row.provider)) return { model: null, unavailable: false };
    return { model: { ...row, provider: row.provider }, unavailable: false };
  } catch {
    return { model: null, unavailable: true };
  }
}

/** "8" for 8.0000, "0.4" for 0.4000; null when the catalog holds no price. */
export function catalogPrice(value: string | null | undefined): string | null {
  const n = value == null ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
}
