// Provider dimension shared across the schema, content frontmatter, and (later)
// the source registry. Phase 2.0 introduces this additively: every existing
// row is Claude, but the column is nullable until a later tightening migration.

import { z } from "zod";

/** Canonical provider keys. Ordering is display order (Claude first — legacy). */
export const PROVIDERS = ["claude", "openai", "gemini"] as const;

export const providerSchema = z.enum(PROVIDERS);

export type Provider = z.infer<typeof providerSchema>;

/** The provider every pre-multi-LLM row/document belongs to. */
export const DEFAULT_PROVIDER: Provider = "claude";

export function isProvider(value: unknown): value is Provider {
  return providerSchema.safeParse(value).success;
}
