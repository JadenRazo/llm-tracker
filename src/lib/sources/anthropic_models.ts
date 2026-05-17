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

const SOURCE_KEY = "anthropic_models";
const MODELS_URL = "https://platform.claude.com/docs/en/about-claude/models/overview";

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

function parseModelsTable(html: string): ParsedModel[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (table.length === 0) return [];

  const headerCells = table.find("thead tr").first().find("th");
  if (headerCells.length < 2) return [];

  // headerCells[0] is the "Feature" label; the rest are model display names.
  const displayNames: string[] = [];
  headerCells.each((i, el) => {
    if (i === 0) return;
    displayNames.push($(el).text().trim());
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
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    // Strip trailing footnote markers ("Pricing1", "Reliable knowledge cutoff 2")
    // that cheerio concatenates into the label text.
    const label = $(cells[0]!).text().trim().replace(/\s*\d+$/, "").trim();
    const values: string[] = [];
    cells.each((i, el) => {
      if (i === 0) return;
      values.push($(el).text().trim());
    });

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
