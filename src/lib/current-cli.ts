// Thin helper that returns the latest CLI version the tracker has observed
// for a provider (via its npm poller). Used by the hero version pill and the
// content staleness checker on guides/tips pages.
//
// Cached for 5 minutes in-process, per provider — page renders are
// server-side and mostly cached by Next.js anyway, but a single-row SELECT
// per request is still worth avoiding. A restart clears the cache.

import { eq, sql } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import { DEFAULT_PROVIDER, type Provider } from "@/lib/providers";
import { getProviderMeta } from "@/lib/provider-meta";

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<Provider, { value: string | null; expiresAt: number }>();

/**
 * Latest CLI version string for `provider`, read from that provider's npm
 * source events. Returns null if nothing has been ingested yet.
 */
export async function getCurrentCliVersion(
  provider: Provider = DEFAULT_PROVIDER,
): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(provider);
  if (hit && hit.expiresAt > now) return hit.value;

  const db = tryGetDb();
  if (!db) return null;

  try {
    const source = getProviderMeta(provider).cliVersionSource;
    // Prefer the newest STABLE release, filtered in SQL rather than by scanning a
    // window of recent rows. Codex publishes alphas and Gemini CLI publishes a
    // nightly most days, so a bounded recency scan was still all-prerelease and
    // the hero pill advertised "0.149.0-alpha.2" / "0.56.0-nightly.20260820..."
    // as the version a reader should be on. The same value drives the guide
    // staleness check, so a prerelease there also skews "verified against".
    // Claude Code ships no prereleases, so this changes nothing for it.
    const stable = await db
      .select({ externalId: events.externalId })
      .from(events)
      .where(sql`${events.source} = ${source} and ${events.externalId} ~ '^[0-9]+\.[0-9]+\.[0-9]+$'`)
      .orderBy(eventRecencyDesc)
      .limit(1);
    if (stable[0]) {
      cache.set(provider, { value: stable[0].externalId, expiresAt: now + CACHE_TTL_MS });
      return stable[0].externalId;
    }

    // No stable release on record yet (a brand-new tool): fall back to the newest
    // of anything rather than showing nothing.
    const rows = await db
      .select({ externalId: events.externalId })
      .from(events)
      .where(eq(events.source, source))
      .orderBy(eventRecencyDesc)
      .limit(1);
    const value = rows[0]?.externalId ?? null;
    cache.set(provider, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch {
    // Don't cache failures — next render retries.
    return null;
  }
}

/** Back-compat alias — Claude-scoped CLI version (staleness checker). */
export function getCurrentClaudeCodeVersion(): Promise<string | null> {
  return getCurrentCliVersion(DEFAULT_PROVIDER);
}
