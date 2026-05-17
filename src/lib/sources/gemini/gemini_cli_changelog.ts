// Fetches the raw Gemini CLI changelog (docs/changelogs/index.md) and splits it
// into one event per `## Announcements: vX.Y.Z - YYYY-MM-DD` section. Body is
// deduped via contentHash. Mirrors claude/claude_code_changelog.ts.

import { and, eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional, sha256Hex } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_cli_changelog";
const PROVIDER: Provider = "gemini";
const CHANGELOG_URL =
  "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/changelogs/index.md";

interface ChangelogSection {
  version: string;
  date: string | null;
  body: string;
}

/**
 * Parse the changelog into {version,date,body}. Recognises headings shaped like
 * `## Announcements: v0.42.0 - 2026-05-12` (date optional / format-tolerant).
 */
function parseChangelog(md: string): ChangelogSection[] {
  const lines = md.split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  const headingRe = /^##\s+Announcements:\s+v?(\d+\.\d+\.\d+[^\s]*)\s*(?:-\s*(.+))?$/i;

  for (const line of lines) {
    const m = headingRe.exec(line.trim());
    if (m) {
      if (current) sections.push(current);
      current = { version: m[1]!, date: m[2]?.trim() ?? null, body: "" };
    } else if (current) {
      current.body += (current.body.length > 0 ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({ ...s, body: s.body.trim() }));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function runGeminiCliChangelog(): Promise<RunResult> {
  const res = await fetchConditional(CHANGELOG_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`Gemini CLI changelog returned status ${res.status}`);
  }

  const sections = parseChangelog(res.body);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const withBodies = sections.filter((s) => s.body.length > 0);
  let skipped = sections.length - withBodies.length;

  if (withBodies.length === 0) {
    return { inserted: 0, updated: 0, skipped, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

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
        title: `Gemini CLI ${section.version}`,
        bodyMd: section.body,
        url: "https://github.com/google-gemini/gemini-cli/blob/main/docs/changelogs/index.md",
        contentHash: hash,
        publishedAt: parseDate(section.date),
        provider: PROVIDER,
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

export const geminiCliChangelogSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runGeminiCliChangelog,
};
