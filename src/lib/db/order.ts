// Canonical recency ordering for the `events` table.
//
// `ORDER BY published_at DESC` is WRONG here: Postgres sorts NULLs FIRST on a
// DESC ordering, and several sources legitimately carry no upstream publish
// date (claude_code_changelog has none at all, and the status/news scrapers
// leave it null when the feed omits one). The result was that every unfiltered
// feed returned NULL-dated rows first — the homepage's "aggregated across every
// provider" strip was 100% claude_code_changelog, showing zero OpenAI or Gemini
// items while the database held 2,795 and 446 of them respectively.
//
// The UI already falls back to `detectedAt` when rendering a date
// (`ev.publishedAt ?? ev.detectedAt`), so ordering must use the same key or the
// list is sorted by one value and labelled with another.

import { sql, type SQL } from "drizzle-orm";
import { events } from "./schema";

/** Newest-first by the same timestamp the UI displays. */
export const eventRecencyDesc: SQL = sql`coalesce(${events.publishedAt}, ${events.detectedAt}) desc`;

/**
 * Matches a STABLE release version — no SemVer prerelease segment.
 *
 * Codex publishes alphas in bursts and Gemini CLI publishes a nightly most days,
 * so "the newest release event" put "0.149.0-alpha.3" and
 * "0.56.0-nightly.20260820.ge90c63fa1" in the hero pill as the version a reader
 * should be on. A prerelease always carries a hyphen after the patch number, so
 * this is a plain LIKE rather than a regex: no backslash-escaping to get wrong
 * across the JS-template / tagged-template / SQL-literal boundaries, which is
 * exactly where the first attempt at this went astray.
 */
export const isStableVersionSql: SQL = sql`${events.externalId} not like '%-%'`;
