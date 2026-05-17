// Thin helper that returns the latest Claude Code CLI version the tracker has
// observed via the npm_claude_code poller. Used by the staleness checker on
// guides/tips pages.
//
// Cached for 5 minutes in-process — page renders are server-side and mostly
// cached by Next.js anyway, but a single-row SELECT per request is still worth
// avoiding. A restart clears the cache; good enough for a tracker UI.

import { desc, eq } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { value: string | null; expiresAt: number } | null = null;

export async function getCurrentClaudeCodeVersion(): Promise<string | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const db = tryGetDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({ externalId: events.externalId })
      .from(events)
      .where(eq(events.source, "npm_claude_code"))
      .orderBy(desc(events.publishedAt))
      .limit(1);
    const value = rows[0]?.externalId ?? null;
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch {
    // Don't cache failures — next render retries.
    return null;
  }
}
