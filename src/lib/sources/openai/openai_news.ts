// Parses openai.com/news/rss.xml (RSS 2.0). The HTML index 403s, so the RSS
// feed is the only viable entry point.
//
// The feed ships a one-paragraph <description> on ~1,035 of its ~1,141 items and
// this source used to hardcode `bodyMd: null`, discarding every one — OpenAI
// news rendered as a bare headline on the home feed and the changelog while
// Gemini's equivalent carried a summary. We keep the summary now.

import * as cheerio from "cheerio";
import { sql } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "openai_news";
const PROVIDER: Provider = "openai";
const RSS_URL = "https://openai.com/news/rss.xml";

interface Article {
  guid: string;
  title: string;
  category: string | null;
  url: string;
  publishedAt: Date | null;
  /** One-paragraph summary from <description>, when the feed supplies one. */
  summary: string | null;
}

/** Upper bound on a stored summary — feed items are a paragraph; anything far
 *  past that is markup we failed to strip, not prose. */
const MAX_SUMMARY_CHARS = 600;

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? u.pathname;
  } catch {
    return url.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  }
}

function parseFeed(xml: string): Article[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const seen = new Set<string>();
  const out: Article[] = [];

  $("item").each((_, el) => {
    const item = $(el);
    const link = item.find("link").first().text().trim();
    const title = item.find("title").first().text().trim();
    if (!link || !title) return;
    const guidText = item.find("guid").first().text().trim();
    const guid = guidText || slugFromUrl(link);
    if (seen.has(guid)) return;
    seen.add(guid);

    const category = item.find("category").first().text().trim() || null;
    // cheerio in xmlMode returns the decoded text of CDATA/entity content; strip
    // any residual tags so a feed that embeds HTML can't inject markup downstream.
    const rawSummary = item.find("description").first().text().trim();
    const summary = rawSummary
      ? rawSummary.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_CHARS) || null
      : null;
    const pubDateRaw = item.find("pubDate").first().text().trim();
    let publishedAt: Date | null = null;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      publishedAt = Number.isNaN(d.getTime()) ? null : d;
    }
    out.push({ guid, title, category, url: link, publishedAt, summary });
  });

  return out;
}

export async function runOpenaiNews(): Promise<RunResult> {
  const res = await fetchConditional(RSS_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`openai.com/news/rss.xml returned status ${res.status}`);
  }

  const articles = parseFeed(res.body);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  if (articles.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const rows = articles.map((article) => ({
    source: SOURCE_KEY,
    type: article.category ? `news:${article.category.toLowerCase()}` : "news",
    externalId: article.guid,
    title: article.title,
    bodyMd: article.summary,
    url: article.url,
    publishedAt: article.publishedAt,
    provider: PROVIDER,
  }));

  const inserted = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  // Backfill: rows ingested before this source kept summaries have body_md NULL.
  // A plain upsert would misreport them as inserts, so fill them in one targeted
  // statement instead. Only NULL bodies are touched — never an existing one.
  const withSummary = rows.filter((r) => r.bodyMd !== null);
  const backfilled = withSummary.length === 0 ? [] : await db
    .update(events)
    .set({ bodyMd: sql`excluded_summary.summary` })
    .from(
      sql`(values ${sql.join(
        withSummary.map((r) => sql`(${r.externalId}, ${r.bodyMd})`),
        sql`, `,
      )}) as excluded_summary(external_id, summary)`,
    )
    .where(
      sql`${events.source} = ${SOURCE_KEY} and ${events.externalId} = excluded_summary.external_id and ${events.bodyMd} is null`,
    )
    .returning({ id: events.id });

  return {
    inserted: inserted.length,
    updated: backfilled.length,
    skipped: articles.length - inserted.length,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const openaiNewsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  // Tier 3 (2h): RSS news, not time-sensitive — aligned with the
  // claude/anthropic_news sibling (also tier 3).
  tier: 3,
  run: runOpenaiNews,
};
