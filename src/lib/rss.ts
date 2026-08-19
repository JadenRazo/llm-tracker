// RSS 2.0 rendering for the event feed.
//
// The footer advertised "RSS · coming soon" with no route behind it; this makes
// the promise true rather than deleting it. One shared builder serves the
// cross-provider feed at /rss.xml and the per-provider feeds at
// /{provider}/rss.xml.

import { eq } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, type Event } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import { getProviderMeta } from "@/lib/provider-meta";
import type { Provider } from "@/lib/providers";

/** Feed length. Enough for a reader to catch up after a week away. */
const FEED_LIMIT = 50;

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://llm.raizhost.com").replace(/\/$/, "");
}

/** XML text escaping — the five predefined entities, nothing else. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function loadFeedEvents(provider?: Provider): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    const q = db.select().from(events);
    const rows = provider
      ? await q.where(eq(events.provider, provider)).orderBy(eventRecencyDesc).limit(FEED_LIMIT)
      : await q.orderBy(eventRecencyDesc).limit(FEED_LIMIT);
    return rows;
  } catch {
    return [];
  }
}

export function renderRss(rows: Event[], provider?: Provider): string {
  const base = siteUrl();
  const label = provider ? getProviderMeta(provider).label : "Claude, OpenAI & Gemini";
  const title = provider ? `LLM Tracker — ${label}` : "LLM Tracker";
  const feedPath = provider ? `/${provider}/rss.xml` : "/rss.xml";
  const description = provider
    ? `Releases, docs, models, and status for ${label}, tracked by LLM Tracker.`
    : "What's shipping across Claude, OpenAI & Gemini — releases, CLIs, models, docs, and status.";

  // Newest item's timestamp, not "now": a feed whose lastBuildDate moves on every
  // request tells aggregators the feed changed when it did not.
  const newest = rows[0] ? (rows[0].publishedAt ?? rows[0].detectedAt) : null;

  const items = rows
    .map((ev) => {
      const date = ev.publishedAt ?? ev.detectedAt;
      const link = ev.url ?? `${base}${provider ? `/${provider}` : ""}/changelog`;
      // Stable, globally unique guid — (source, external_id) is the table's own
      // uniqueness contract, so it survives re-scrapes and row-id changes.
      const guid = `${base}/e/${encodeURIComponent(ev.source)}/${encodeURIComponent(ev.externalId)}`;
      return [
        "    <item>",
        `      <title>${xmlEscape(ev.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="false">${xmlEscape(guid)}</guid>`,
        `      <pubDate>${date.toUTCString()}</pubDate>`,
        `      <category>${xmlEscape(ev.provider)}</category>`,
        `      <source url="${xmlEscape(`${base}${feedPath}`)}">${xmlEscape(ev.source)}</source>`,
        ev.bodyMd ? `      <description>${xmlEscape(ev.bodyMd)}</description>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(title)}</title>`,
    `    <link>${xmlEscape(`${base}${provider ? `/${provider}` : ""}`)}</link>`,
    `    <description>${xmlEscape(description)}</description>`,
    "    <language>en</language>",
    `    <atom:link href="${xmlEscape(`${base}${feedPath}`)}" rel="self" type="application/rss+xml" />`,
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : "",
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
