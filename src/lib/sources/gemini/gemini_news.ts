// Tier 2 (30m, deliberate): this is the Gemini *changelog* proxy serving as
// the user-approved NEWS substitute (Google has no single Gemini news feed like
// anthropic.com/news). Because it's the changelog, freshness/latency matters
// more than for a plain marketing news feed, so it sits at 30m rather than the
// 2h news tier — but not 10m (the changelog doesn't move that fast and a
// tighter cadence isn't worth the cost).
//
// Fetches the Gemini API changelog (changelog.md.txt) and splits it into one
// event per `## <Month DD, YYYY>` dated section. This is the user-approved
// provider-level NEWS proxy for Gemini (Google has no single Gemini news feed
// equivalent to anthropic.com/news). Body deduped via contentHash; tagged as
// type "news" so it aggregates with other providers' news.

import { and, eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional, sha256Hex } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_news";
const PROVIDER: Provider = "gemini";
const CHANGELOG_URL = "https://ai.google.dev/gemini-api/docs/changelog.md.txt";
const DOCS_URL = "https://ai.google.dev/gemini-api/docs/changelog";

interface DatedSection {
  dateLabel: string;
  publishedAt: Date | null;
  body: string;
}

/** Recognises `## May 7, 2026` style date headings. */
function parseSections(md: string): DatedSection[] {
  const lines = md.split(/\r?\n/);
  const sections: DatedSection[] = [];
  let current: DatedSection | null = null;
  const headingRe =
    /^##\s+((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s*$/i;

  for (const line of lines) {
    const m = headingRe.exec(line.trim());
    if (m) {
      if (current) sections.push(current);
      const label = m[1]!;
      const d = new Date(label);
      current = {
        dateLabel: label,
        publishedAt: Number.isNaN(d.getTime()) ? null : d,
        body: "",
      };
    } else if (current) {
      current.body += (current.body.length > 0 ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({ ...s, body: s.body.trim() }));
}

/** Stable per-day external id, e.g. "2026-05-07"; falls back to a slug. */
function externalIdFor(s: DatedSection): string {
  if (s.publishedAt) return s.publishedAt.toISOString().slice(0, 10);
  return s.dateLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function runGeminiNews(): Promise<RunResult> {
  const res = await fetchConditional(CHANGELOG_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`Gemini API changelog returned status ${res.status}`);
  }

  const sections = parseSections(res.body).filter((s) => s.body.length > 0);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  if (sections.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const ids = sections.map(externalIdFor);
  const existingRows = await db
    .select({ id: events.id, externalId: events.externalId, contentHash: events.contentHash })
    .from(events)
    .where(and(eq(events.source, SOURCE_KEY), inArray(events.externalId, ids)));
  const existing = new Map(existingRows.map((r) => [r.externalId, { id: r.id, contentHash: r.contentHash }]));

  const toInsert: Array<typeof events.$inferInsert> = [];
  const toUpdate: Array<{ id: number; body: string; hash: string }> = [];
  let skipped = 0;

  for (const section of sections) {
    const externalId = externalIdFor(section);
    const hash = sha256Hex(section.body);
    const prior = existing.get(externalId);
    if (!prior) {
      toInsert.push({
        source: SOURCE_KEY,
        type: "news",
        externalId,
        title: `Gemini API — ${section.dateLabel}`,
        bodyMd: section.body,
        url: DOCS_URL,
        contentHash: hash,
        publishedAt: section.publishedAt,
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

export const geminiNewsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runGeminiNews,
};
