// Scrapes anthropic.com/news for article cards. Stores link + title only; we don't
// fetch the individual article bodies (would multiply request count for little gain).

import * as cheerio from "cheerio";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";

const SOURCE_KEY = "anthropic_news";
const NEWS_URL = "https://www.anthropic.com/news";

function slugFromHref(href: string): string {
  try {
    const u = new URL(href, "https://www.anthropic.com");
    // e.g. /news/claude-4 → claude-4
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? u.pathname;
  } catch {
    return href.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  }
}

interface Article {
  slug: string;
  title: string;
  category: string | null;
  url: string;
  publishedAt: Date | null;
}

// Anthropic's card markup concatenates date + category + headline into one text
// node with no whitespace: "Mar 10, 2026AnnouncementsSydney will become..."
// Split those pieces out so we can store a clean title + actual published_at.
const DATE_CATEGORY_PREFIX =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s*(Announcements|Policy|Product|Research|Interpretability|Societal Impacts|Alignment|Company|News)?/;

function splitCardText(raw: string): { title: string; category: string | null; publishedAt: Date | null } {
  const text = raw.trim().replace(/\s+/g, " ");
  const match = text.match(DATE_CATEGORY_PREFIX);
  if (!match) return { title: text, category: null, publishedAt: null };

  const dateStr = match[0].replace(match[2] ?? "", "").trim();
  const parsed = new Date(dateStr);
  const publishedAt = Number.isNaN(parsed.getTime()) ? null : parsed;
  const title = text.slice(match[0].length).trim();
  return { title: title || text, category: match[2] ?? null, publishedAt };
}

function parseArticles(html: string): Article[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: Article[] = [];

  $('a[href^="/news/"], a[href^="https://www.anthropic.com/news/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href === "/news" || href === "/news/") return;
    const raw = $(el).text();
    if (!raw || raw.trim().length < 4) return;
    const slug = slugFromHref(href);
    if (seen.has(slug)) return;
    seen.add(slug);

    const { title, category, publishedAt } = splitCardText(raw);
    const url = href.startsWith("http") ? href : `https://www.anthropic.com${href}`;
    out.push({ slug, title, category, url, publishedAt });
  });

  return out;
}

export async function runAnthropicNews(): Promise<RunResult> {
  const res = await fetchConditional(NEWS_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`anthropic.com/news returned status ${res.status}`);
  }

  const articles = parseArticles(res.body);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  if (articles.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const rows = articles.map((article) => ({
    source: SOURCE_KEY,
    type: article.category ? `news:${article.category.toLowerCase()}` : "news",
    externalId: article.slug,
    title: article.title,
    bodyMd: null,
    url: article.url,
    publishedAt: article.publishedAt,
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
