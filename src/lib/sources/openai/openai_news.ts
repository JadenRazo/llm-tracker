// Parses openai.com/news/rss.xml (RSS 2.0). Stores link + title + date only.
// The HTML index 403s, so the RSS feed is the only viable entry point.
// Event shape mirrors claude/anthropic_news.ts (one event per item, no body).

import * as cheerio from "cheerio";
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
}

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
    const pubDateRaw = item.find("pubDate").first().text().trim();
    let publishedAt: Date | null = null;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      publishedAt = Number.isNaN(d.getTime()) ? null : d;
    }
    out.push({ guid, title, category, url: link, publishedAt });
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
    bodyMd: null,
    url: article.url,
    publishedAt: article.publishedAt,
    provider: PROVIDER,
  }));

  const inserted = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  return {
    inserted: inserted.length,
    updated: 0,
    skipped: articles.length - inserted.length,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const openaiNewsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runOpenaiNews,
};
