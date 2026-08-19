// Thin helper that returns the latest CLI version the tracker has observed
// for a provider (via its npm poller). Used by the hero version pill and the
// content staleness checker on guides/tips pages.
//
// Cached for 5 minutes in-process, per provider — page renders are
// server-side and mostly cached by Next.js anyway, but a single-row SELECT
// per request is still worth avoiding. A restart clears the cache.

import { eq } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import { DEFAULT_PROVIDER, type Provider } from "@/lib/providers";
import { getProviderMeta } from "@/lib/provider-meta";

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<Provider, { value: string | null; expiresAt: number }>();

/** How many recent versions to scan before giving up on finding a stable one. */
const STABLE_SCAN_LIMIT = 60;

/**
 * A release with no SemVer prerelease segment — "0.148.0" yes,
 * "0.149.0-alpha.1" / "0.56.0-nightly.20260819.g571851b10" no.
 */
function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

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
    // Prefer the newest STABLE release. Codex and Gemini CLI publish alphas and
    // nightlies to npm constantly, so "newest event" put "0.149.0-alpha.1" and
    // "0.56.0-nightly.20260819.g571851b10" in the hero pill as the version a
    // reader should be on — and the same value drives the guide staleness check.
    // Claude Code publishes no prereleases, so this changes nothing there.
    const rows = await db
      .select({ externalId: events.externalId })
      .from(events)
      .where(eq(events.source, source))
      .orderBy(eventRecencyDesc)
      .limit(STABLE_SCAN_LIMIT);
    const value =
      rows.find((r) => isStableVersion(r.externalId))?.externalId ??
      rows[0]?.externalId ??
      null;
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
