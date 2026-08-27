// Scrapes platform.claude.com/docs/en/about-claude/models/overview — the public
// models catalog page — and upserts every generally-available model into the
// `models` table. Emits a "new_model" event on first insert.
//
// No API key required: the docs page carries more information than /v1/models
// (pricing, context, max output, capabilities), and is reachable anonymously.
//
// Parsing strategy: the page renders a pivoted feature × model table. We read
// the header row for display names, then walk each subsequent row keyed by the
// first-cell feature label ("Context window", "Pricing", "Max output", etc.).
// Feature-label keying survives column reorderings and added rows.
//
// If zero models parse, we throw — the runner records it in poller_runs as an
// error, so a docs-site markup change surfaces immediately instead of silently
// emptying the catalog.

import * as cheerio from "cheerio";
import { eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, models } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "anthropic_models";
const PROVIDER: Provider = "claude";
// 2026-08-26: the docs moved from /docs/en/about-claude/models/overview (the old
// path 301s here). Fetch the canonical URL directly so we don't depend on the
// redirect surviving the next docs reshuffle.
const MODELS_URL = "https://platform.claude.com/docs/en/models/overview";

interface ParsedModel {
  id: string;
  displayName: string;
  contextWindow: number | null;
  maxOutput: number | null;
  pricingIn: string | null;
  pricingOut: string | null;
  capabilities: Record<string, boolean>;
}

function parseTokenCount(raw: string): number | null {
  // Accepts "1M tokens", "200k tokens", "128,000 tokens", "1,000,000".
  const m = raw.match(/([\d,.]+)\s*([mMkK])?/);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "m") return Math.round(n * 1_000_000);
  if (suffix === "k") return Math.round(n * 1_000);
  return Math.round(n);
}

function parsePricing(raw: string): { pricingIn: string | null; pricingOut: string | null } {
  // Accepts "$5 / input MTok $25 / output MTok" and minor variants. The dollar
  // figure can be an integer or decimal. We tolerate extra whitespace/footnote
  // superscripts from the docs rendering.
  const inMatch = raw.match(/\$\s*([\d.]+)\s*\/\s*input/i);
  const outMatch = raw.match(/\$\s*([\d.]+)\s*\/\s*output/i);
  return {
    pricingIn: inMatch ? inMatch[1]! : null,
    pricingOut: outMatch ? outMatch[1]! : null,
  };
}

function isYes(raw: string): boolean {
  return /^\s*yes\b/i.test(raw);
}

// Exported so the parser can be verified ad hoc against a saved copy of the
// live page (there is no test framework in this repo; the runtime
// throw-on-zero below is the standing guard against upstream markup drift).
export function parseModelsTable(html: string): ParsedModel[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (table.length === 0) return [];

  const headerCells = table.find("thead tr").first().find("th");
  if (headerCells.length < 2) return [];

  // headerCells[0] is the "Feature" label; the rest are model display names.
  // 2026-08-24 markup: each header cell now stacks the model name (an <a>) on a
  // tagline <span>, so bare .text() concatenates both ("Claude Fable 5Next-
  // generation intelligence…"). Prefer the link text; fall back to full text
  // for the pre-08-24 plain-text shape.
  const displayNames: string[] = [];
  headerCells.each((i, el) => {
    if (i === 0) return;
    const link = $(el).find("a").first();
    const name = (link.length > 0 ? link.text() : $(el).text()).trim();
    displayNames.push(name);
  });

  // Seed parsed records — id will be filled in from the "Claude API ID" row.
  const parsed: ParsedModel[] = displayNames.map((name) => ({
    id: "",
    displayName: name,
    contextWindow: null,
    maxOutput: null,
    pricingIn: null,
    pricingOut: null,
    capabilities: { toolUse: true, vision: true },
  }));

  table.find("tbody tr").each((_, tr) => {
    // 2026-08-24 markup: the feature label moved from the row's first <td> into
    // a row-scoped <th> (<tr><th>Pricing</th><td>…</td>×N</tr>), which is what
    // silently zeroed this parser — every <td> became a "value" and no label
    // ever matched. Handle both shapes: th-labeled rows use every <td> as a
    // value; the legacy shape keeps first-<td>-is-label.
    const rowTh = $(tr).find("th").first();
    const cells = $(tr).find("td");
    let rawLabel: string;
    const values: string[] = [];
    if (rowTh.length > 0) {
      rawLabel = rowTh.text();
      cells.each((_i, el) => {
        values.push($(el).text().trim());
      });
    } else {
      if (cells.length < 2) return;
      rawLabel = $(cells[0]!).text();
      cells.each((i, el) => {
        if (i === 0) return;
        values.push($(el).text().trim());
      });
    }
    if (values.length === 0) return;
    // Sanitize the label: the docs render tooltip icons as PRIVATE-USE-AREA
    // glyphs from an icon font ("Claude API ID<U+E08F>"), which .trim() does not
    // touch and which broke every === comparison in the 2026-08-24 markup. Also
    // strip trailing footnote markers ("Pricing1") that cheerio concatenates in.
    const label = rawLabel
      .replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "")
      .trim()
      .replace(/\s*\d+$/, "")
      .trim();

    for (let i = 0; i < parsed.length && i < values.length; i++) {
      const v = values[i]!;
      const rec = parsed[i]!;
      if (label === "Claude API ID") rec.id = v;
      else if (label === "Context window") rec.contextWindow = parseTokenCount(v);
      else if (label === "Max output") rec.maxOutput = parseTokenCount(v);
      else if (label === "Pricing") {
        const p = parsePricing(v);
        rec.pricingIn = p.pricingIn;
        rec.pricingOut = p.pricingOut;
      } else if (label === "Thinking") {
        // 2026-08-24: the separate Extended/Adaptive yes-no rows collapsed into
        // one "Thinking" row whose value names the mode ("Adaptive (always
        // on)", "Adaptive", "Extended").
        rec.capabilities.adaptiveThinking = /adaptive/i.test(v);
        rec.capabilities.extendedThinking = /extended/i.test(v);
      } else if (label === "Extended thinking") rec.capabilities.extendedThinking = isYes(v);
      else if (label === "Adaptive thinking") rec.capabilities.adaptiveThinking = isYes(v);
      else if (label === "Priority Tier") rec.capabilities.priorityTier = isYes(v);
    }
  });

  return parsed.filter((m) => m.id.length > 0);
}

export async function runAnthropicModels(): Promise<RunResult> {
  const res = await fetchConditional(MODELS_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`models overview page returned status ${res.status}`);
  }

  const parsed = parseModelsTable(res.body);
  if (parsed.length === 0) {
    throw new Error("parsed zero models from overview page — docs markup likely changed");
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const ids = parsed.map((m) => m.id);
  const existingIds = new Set(
    (await db.select({ id: models.id }).from(models).where(inArray(models.id, ids))).map((r) => r.id),
  );

  const now = new Date();
  const newModels = parsed.filter((m) => !existingIds.has(m.id));
  const updatedModels = parsed.filter((m) => existingIds.has(m.id));

  let inserted = 0;
  let updated = 0;

  if (newModels.length > 0) {
    await db.insert(models).values(
      newModels.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        pricingIn: m.pricingIn,
        pricingOut: m.pricingOut,
        capabilities: m.capabilities,
        firstSeenAt: now,
        lastSeenAt: now,
        provider: PROVIDER,
      })),
    );
    inserted = newModels.length;

    // One bulk insert for new-model events — unique index on (source, external_id)
    // drops any that already exist (e.g. a model re-appearing after a delete).
    await db
      .insert(events)
      .values(
        newModels.map((m) => ({
          source: SOURCE_KEY,
          type: "new_model",
          externalId: m.id,
          title: `New model: ${m.displayName}`,
          bodyMd: `Model ID: \`${m.id}\`\n\nListed on the Anthropic models overview as of ${now.toISOString().slice(0, 10)}.`,
          url: `${MODELS_URL}#${m.id}`,
          publishedAt: now,
          provider: PROVIDER,
        })),
      )
      .onConflictDoNothing({ target: [events.source, events.externalId] });
  }

  // Updates still iterate — each row has different SET values. Cheap relative
  // to the prior per-row SELECT + INSERT.
  for (const m of updatedModels) {
    await db
      .update(models)
      .set({
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        pricingIn: m.pricingIn,
        pricingOut: m.pricingOut,
        capabilities: m.capabilities,
        lastSeenAt: now,
      })
      .where(eq(models.id, m.id));
    updated++;
  }

  return { inserted, updated, skipped: 0, status: "ok", etag: res.etag, lastModified: res.lastModified };
}

export const anthropicModelsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runAnthropicModels,
};
