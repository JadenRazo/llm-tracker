// Fetches the raw CHANGELOG.md from the anthropics/claude-code repo and splits
// it into one event per `## X.Y.Z` section. Body is deduped via contentHash.

import { and, eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional, sha256Hex } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";

const SOURCE_KEY = "claude_code_changelog";
const CHANGELOG_URL = "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";

interface ChangelogSection {
  version: string;
  body: string;
}

/**
 * Parse a CHANGELOG.md body into {version, body} sections. Recognises headings
 * shaped like `## 1.2.3`, `## v1.2.3`, or `## 1.2.3 (2025-01-01)`.
 */
function parseChangelog(md: string): ChangelogSection[] {
  const lines = md.split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  const headingRe = /^##\s+v?(\d+\.\d+\.\d+[^\s]*)/;

  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { version: m[1]!, body: "" };
    } else if (current) {
      current.body += (current.body.length > 0 ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({ version: s.version, body: s.body.trim() }));
}

export async function runClaudeCodeChangelog(): Promise<RunResult> {
  const res = await fetchConditional(CHANGELOG_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`CHANGELOG fetch returned status ${res.status}`);
  }

  const sections = parseChangelog(res.body);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const withBodies = sections.filter((s) => s.body.length > 0);
  let skipped = sections.length - withBodies.length;

  if (withBodies.length === 0) {
    return { inserted: 0, updated: 0, skipped, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  // Single round-trip for all existing (version, contentHash) tuples covering
  // this batch — replaces an N-query SELECT-then-INSERT loop.
  const versions = withBodies.map((s) => s.version);
  const existingRows = await db
    .select({ id: events.id, externalId: events.externalId, contentHash: events.contentHash })
    .from(events)
    .where(and(eq(events.source, SOURCE_KEY), inArray(events.externalId, versions)));
  const existing = new Map(existingRows.map((r) => [r.externalId, { id: r.id, contentHash: r.contentHash }]));

  const toInsert: Array<typeof events.$inferInsert> = [];
  const toUpdate: Array<{ id: number; body: string; hash: string }> = [];

  for (const section of withBodies) {
    const hash = sha256Hex(section.body);
    const prior = existing.get(section.version);
    if (!prior) {
      toInsert.push({
        source: SOURCE_KEY,
        type: "changelog",
        externalId: section.version,
        title: `Claude Code ${section.version}`,
        bodyMd: section.body,
        url: `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#${section.version.replace(/\./g, "")}`,
        contentHash: hash,
      });
    } else if (prior.contentHash !== hash) {
      toUpdate.push({ id: prior.id, body: section.body, hash });
    } else {
      skipped++;
    }
  }

  let inserted = 0;
  let updated = 0;

  if (toInsert.length > 0) {
    const insertedRows = await db
      .insert(events)
      .values(toInsert)
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({ id: events.id });
    inserted = insertedRows.length;
    skipped += toInsert.length - insertedRows.length;
  }
  for (const u of toUpdate) {
    await db
      .update(events)
      .set({ bodyMd: u.body, contentHash: u.hash, detectedAt: new Date() })
      .where(eq(events.id, u.id));
    updated++;
  }

  return {
    inserted,
    updated,
    skipped,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}
