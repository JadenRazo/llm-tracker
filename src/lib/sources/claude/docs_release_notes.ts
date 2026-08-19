// HTML-scrapes Anthropic's docs release-notes pages. One event per page-slug per
// calendar day, if the body hash has changed since the last run.

import * as cheerio from "cheerio";
import { desc, eq } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, pollerRuns } from "@/lib/db/schema";
import { sha256Hex } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "docs_release_notes";
const PROVIDER: Provider = "claude";
const BODY_MAX = 20_000;

const PAGES: { slug: string; url: string }[] = [
  { slug: "api", url: "https://platform.claude.com/docs/en/release-notes/api" },
  { slug: "claude-code", url: "https://platform.claude.com/docs/en/release-notes/claude-code" },
  { slug: "claude-apps", url: "https://platform.claude.com/docs/en/release-notes/claude-apps" },
  { slug: "system-prompts", url: "https://platform.claude.com/docs/en/release-notes/system-prompts" },
];

/**
 * Collapse the HTML body of a docs page down to the main article content and
 * convert it to a rough markdown representation. Not a full HTML-to-MD conversion
 * — we just want something stable to hash and render as text.
 */
function extractMarkdown(html: string): string {
  const $ = cheerio.load(html);
  // Kill nav/script/style elements that change often but aren't content.
  $("script,style,noscript,nav,header,footer,aside").remove();

  // Pick the most likely main-content container.
  const candidates = ["main article", "article", "main", ".docs-content", "#content"];
  let root = $();
  for (const sel of candidates) {
    const found = $(sel).first();
    if (found.length > 0) {
      root = found;
      break;
    }
  }
  if (root.length === 0) root = $("body");

  const chunks: string[] = [];
  root.find("h1,h2,h3,h4,h5,h6,p,li,pre,code").each((_, el) => {
    // cheerio's Element type has a `tagName` field; accessed via any to dodge
    // version-specific type churn between cheerio releases.
    const tag = String((el as { tagName?: string }).tagName ?? "").toLowerCase();
    const text = $(el).text().trim();
    if (!text) return;
    if (tag === "h1") chunks.push(`# ${text}`);
    else if (tag === "h2") chunks.push(`## ${text}`);
    else if (tag === "h3") chunks.push(`### ${text}`);
    else if (tag === "h4") chunks.push(`#### ${text}`);
    else if (tag === "h5" || tag === "h6") chunks.push(`##### ${text}`);
    else if (tag === "li") chunks.push(`- ${text}`);
    else if (tag === "pre" || tag === "code") chunks.push("```\n" + text + "\n```");
    else chunks.push(text);
  });

  return chunks.join("\n\n").slice(0, BODY_MAX);
}

async function lastHashFor(slug: string): Promise<string | null> {
  const db = tryGetDb();
  if (!db) return null;
  const sourceKey = `${SOURCE_KEY}:${slug}`;
  const rows = await db
    .select({ lastSeenHash: pollerRuns.lastSeenHash })
    .from(pollerRuns)
    .where(eq(pollerRuns.source, sourceKey))
    .orderBy(desc(pollerRuns.startedAt))
    .limit(1);
  return rows[0]?.lastSeenHash ?? null;
}

async function recordPageRun(slug: string, hash: string, status: string): Promise<void> {
  const db = tryGetDb();
  if (!db) return;
  await db.insert(pollerRuns).values({
    source: `${SOURCE_KEY}:${slug}`,
    status,
    lastSeenHash: hash,
    finishedAt: new Date(),
  });
}

async function fetchPage(page: { slug: string; url: string }): Promise<{ slug: string; html: string | null; status: number }> {
  try {
    const res = await fetch(page.url, {
      headers: { "User-Agent": "llm-tracker/0.1 (+https://llm.raizhost.com)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[${SOURCE_KEY}] ${page.slug} HTTP ${res.status}`);
      return { slug: page.slug, html: null, status: res.status };
    }
    return { slug: page.slug, html: await res.text(), status: res.status };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] ${page.slug} fetch failed:`, err instanceof Error ? err.message : String(err));
    return { slug: page.slug, html: null, status: 0 };
  }
}

export async function runDocsReleaseNotes(): Promise<RunResult> {
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  // Pages are independent — fetch all four in parallel.
  const fetched = await Promise.all(PAGES.map(fetchPage));

  let inserted = 0;
  let skipped = 0;
  let pageFailures = 0;

  for (const result of fetched) {
    const page = PAGES.find((p) => p.slug === result.slug)!;
    if (!result.html) {
      pageFailures++;
      continue;
    }
    const bodyMd = extractMarkdown(result.html);
    if (!bodyMd) {
      skipped++;
      continue;
    }
    const hash = sha256Hex(bodyMd);
    const previous = await lastHashFor(page.slug);

    if (previous === hash) {
      skipped++;
      await recordPageRun(page.slug, hash, "unchanged");
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);
    const externalId = `${page.slug}:${today}`;

    const existing = await db
      .select({ id: events.id, contentHash: events.contentHash })
      .from(events)
      .where(eq(events.externalId, externalId))
      .limit(1);

    if (existing.length === 0) {
      // Idempotent: this `events` row survives even if its cli_reference/doc row is
      // later removed and re-added, so without this the whole run threw on a unique
      // (source, external_id) violation and lost every later item.
      await db.insert(events).values({
        source: SOURCE_KEY,
        type: page.slug,
        externalId,
        title: `${page.slug} release notes updated`,
        bodyMd,
        url: page.url,
        contentHash: hash,
        publishedAt: new Date(),
        provider: PROVIDER,
      })
      .onConflictDoNothing({ target: [events.source, events.externalId] });
      inserted++;
    } else if (existing[0]!.contentHash !== hash) {
      await db
        .update(events)
        .set({ bodyMd, contentHash: hash, detectedAt: new Date() })
        .where(eq(events.id, existing[0]!.id));
      inserted++;
    } else {
      skipped++;
    }

    await recordPageRun(page.slug, hash, "ok");
  }

  // Surface total failure (all pages errored) so poller_runs records an error
  // rather than silently logging "ok" with zero work done.
  const status = pageFailures === PAGES.length ? "skipped" : "ok";
  return { inserted, updated: 0, skipped: skipped + pageFailures, status };
}

export const docsReleaseNotesSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 3,
  run: runDocsReleaseNotes,
};
