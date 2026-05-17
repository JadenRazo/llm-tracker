// Pure extractors for the homepage "What's new" section.
//
// Consumers feed in raw `Event[]` rows (no DB access here) and get back
// structured, deduped data ready for render. Keeping this layer pure means
// the extractors can be unit-tested in isolation and the page component
// stays focused on data fetching + composition.

import type { Event } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ModelAnnouncement {
  name: string;
  tier: "Opus" | "Sonnet" | "Haiku";
  publishedAt: Date;
  summary: string;
  url: string | null;
}

export interface NewsItem {
  title: string;
  summary: string;
  publishedAt: Date;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** First sentence of a block of prose, soft-capped. Falls back to a truncated
 *  version of the whole string if no sentence boundary is found. */
function firstSentence(body: string, cap = 160): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const sentence = (match ? match[1] : trimmed).trim();
  if (sentence.length <= cap) return sentence;
  return `${sentence.slice(0, cap).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Model announcements / news
// ---------------------------------------------------------------------------

const MODEL_RE = /Introducing Claude (Opus|Sonnet|Haiku)(?:\s+[\d.]+)?/i;

/** Some anthropic_news rows are scraped into one long string where the title,
 *  a category chip, a date, and the lead paragraph are concatenated. Split
 *  them apart so we can produce a clean title and a usable summary. */
export interface ParsedNews {
  title: string;
  summary: string;
}

const CATEGORY_DATE_RE =
  /(Product|Announcements|Engineering|Research|Policy|Interpretability|Societal\s*Impacts)((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2},?\s*\d{4})/i;

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Some anthropic_news titles embed a chip like "ProductApr 16, 2026" that
 *  represents the upstream publish date. When we can parse it, return a Date;
 *  otherwise null so callers fall back to detectedAt. */
function embeddedChipDate(title: string): Date | null {
  const match = title.match(CATEGORY_DATE_RE);
  if (!match) return null;
  const dateStr = match[2];
  const m = dateStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2}),?\s*(\d{4})/i);
  if (!m) return null;
  const month = MONTH_LOOKUP[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (Number.isNaN(day) || Number.isNaN(year) || month === undefined) return null;
  return new Date(Date.UTC(year, month, day));
}

/** Preferred event timestamp: true publishedAt if set, else a date parsed
 *  out of the title chip (common for anthropic_news rows), else detectedAt. */
function bestWhen(ev: Event): Date {
  if (ev.publishedAt) return ev.publishedAt;
  const chip = embeddedChipDate(ev.title);
  if (chip) return chip;
  return ev.detectedAt;
}

export function parseNewsRow(ev: Event): ParsedNews {
  const raw = ev.title;

  // Case A: "ProductApr 17, 2026Introducing Claude Design by Anthropic LabsToday, …"
  //   The category+date prefix is leading. Strip it. The remainder is
  //   "<headline><summary>". Split on the heuristic that the headline ends
  //   when a sentence-like segment begins (uppercase word followed by
  //   lowercase prose, often after a product/feature name).
  // Case B: "Introducing Claude Opus 4.7ProductApr 16, 2026Our latest Opus …"
  //   The category+date chunk is sandwiched in the middle.
  const chipMatch = raw.match(CATEGORY_DATE_RE);

  if (!chipMatch) {
    // No chip — title is the headline, no embedded summary.
    return {
      title: raw.trim(),
      summary: firstSentence(ev.bodyMd ?? "", 160),
    };
  }

  const chipStart = chipMatch.index ?? 0;
  const chipEnd = chipStart + chipMatch[0].length;
  const before = raw.slice(0, chipStart).trim();
  const after = raw.slice(chipEnd).trim();

  let headline = "";
  let summary = "";

  if (before && after) {
    // Case B — headline is before, summary is after.
    headline = before;
    summary = after;
  } else if (after) {
    // Case A — the remainder after the chip contains both headline + summary.
    // Split at the first period-then-space, else at the first capital letter
    // that follows several lowercase characters.
    const periodSplit = after.match(/^(.+?[.!?])\s+(.+)$/);
    if (periodSplit) {
      headline = periodSplit[1].trim();
      summary = periodSplit[2].trim();
    } else {
      // No sentence boundary — try to split between the headline and the
      // lead sentence. The headline ends where a lowercase->uppercase
      // transition begins a new clause, e.g. "…AnthropicLabsToday, we're".
      const headlineMatch = after.match(/^(.+?[a-z])([A-Z][a-z].+)$/);
      if (headlineMatch) {
        headline = headlineMatch[1].trim();
        summary = headlineMatch[2].trim();
      } else {
        headline = after;
        summary = "";
      }
    }
  } else {
    headline = before;
    summary = "";
  }

  // Fallback for summary: use bodyMd if the split produced nothing useful.
  if (!summary) {
    summary = firstSentence(ev.bodyMd ?? "", 160);
  } else {
    summary = firstSentence(summary, 160);
  }

  return {
    title: headline.replace(/\s+/g, " ").trim() || raw,
    summary,
  };
}

/**
 * Picks the most recent "Introducing Claude <tier>" announcement. Returns
 * null if no matching row exists. Tier is derived from the match so callers
 * can style the callout by tier colour.
 */
export function extractLatestModel(newsEvents: Event[]): ModelAnnouncement | null {
  let best: { ev: Event; match: RegExpMatchArray; when: Date } | null = null;

  for (const ev of newsEvents) {
    const m = ev.title.match(MODEL_RE);
    if (!m) continue;
    const when = bestWhen(ev);
    if (!best || when.getTime() > best.when.getTime()) {
      best = { ev, match: m, when };
    }
  }

  if (!best) return null;

  const parsed = parseNewsRow(best.ev);
  // The parsed title retains the "Introducing Claude …" phrase. Extract the
  // exact "Claude <Tier> <version>" slug so the card can lead with the name.
  const nameMatch = parsed.title.match(/Claude\s+(Opus|Sonnet|Haiku)(?:\s+[\d.]+)?/i);
  const name = nameMatch ? nameMatch[0].replace(/\s+/g, " ") : parsed.title;
  const tier = best.match[1] as ModelAnnouncement["tier"];

  return {
    name,
    tier,
    publishedAt: best.when,
    summary: parsed.summary || firstSentence(best.ev.bodyMd ?? "", 160),
    url: best.ev.url,
  };
}

/**
 * Returns up to `limit` recent anthropic_news items, with a cleaned title,
 * a short summary, and a stable sort (newest first). Dedupes any item whose
 * cleaned title matches the latest model announcement's name so the model
 * callout isn't echoed in the news list.
 */
export function pickRecentNews(
  newsEvents: Event[],
  limit: number,
  opts?: { excludeModelName?: string },
): NewsItem[] {
  const sorted = [...newsEvents]
    .map((ev) => ({ ev, when: bestWhen(ev) }))
    .sort((a, b) => b.when.getTime() - a.when.getTime());

  const excludeKey = opts?.excludeModelName?.toLowerCase() ?? null;
  const out: NewsItem[] = [];

  for (const { ev, when } of sorted) {
    if (out.length >= limit) break;
    const parsed = parseNewsRow(ev);
    if (!parsed.title) continue;
    if (excludeKey && parsed.title.toLowerCase().includes(excludeKey)) continue;
    out.push({
      title: parsed.title,
      summary: parsed.summary,
      publishedAt: when,
      url: ev.url,
    });
  }

  return out;
}
