// Scrapes ai.google.dev/gemini-api/docs/models and upserts into `models`.
//
// Unlike Anthropic's docs, this page is a server-rendered *card grid* — no
// pivoted feature table. Each model is an anchor card:
//   <a href="/gemini-api/docs/models/<slug>" class="gemini-card-centered">
//     <h3 id="<slug>" data-text="Gemini 3.1 Pro">Gemini 3.1 Pro</h3>
//     <p class="description-centered">...</p>
//     <p class="status-subtext">Preview|Stable</p>
//   </a>
// The card grid carries no context-window data, but each model's DETAIL page
// (/gemini-api/docs/models/<slug>) has a "Token limits" table with input and
// output limits. Without it every Gemini row rendered "—" in every numeric
// column and the page's "Largest context" stat read "—" across a 17-row table.
// We enrich from the detail page ONLY for rows whose contextWindow is still
// null, so steady-state costs zero extra requests and a newly-listed model is
// filled in on the run that first sees it. Pricing is still not published in
// the docs and stays null.
//
// Layout is fragile. If zero models parse we do NOT throw — we log and return
// status "skipped" so a Google docs redesign degrades gracefully rather than
// erroring the poller (Anthropic's page is stable enough to throw on; this one
// is not).
//
// models.id namespacing: model ids are the bare upstream slug, NOT
// provider-namespaced (Phase 2.2 decision — re-namespacing models.id was judged
// higher risk than the predicate below). To prevent a future cross-provider id
// collision from reading/overwriting another provider's row, every read and
// write here is provider-scoped via `eq(models.provider, PROVIDER)` (the
// existence query and the update `.where(...)`). Keep that invariant if this
// module's read/write paths change.

import * as cheerio from "cheerio";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, models } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_models";
const PROVIDER: Provider = "gemini";
const MODELS_URL = "https://ai.google.dev/gemini-api/docs/models";
const MODEL_DETAIL_URL = (slug: string) => `${MODELS_URL}/${slug}`;
/** Cap on detail fetches per run so a docs restructure can't fan out unboundedly. */
const MAX_DETAIL_FETCHES = 25;

interface ModelDetail {
  contextWindow: number | null;
  maxOutput: number | null;
  capabilities: Record<string, boolean>;
}

const EMPTY_DETAIL: ModelDetail = { contextWindow: null, maxOutput: null, capabilities: {} };

/** "1,048,576" -> 1048576; anything non-numeric -> null. */
function parseCount(text: string): number | null {
  const n = Number.parseInt(text.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** camelCase key for the capabilities jsonb, matching the Claude rows' style. */
function capabilityKey(label: string): string {
  const parts = label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/);
  return parts
    .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join("");
}

/**
 * Read token limits and capabilities off a model detail page.
 *
 * The values are NOT in plain table cells — each lives in a
 * `<section><p><b>Label</b></p><p>Value</p></section>` block inside a
 * `td.gemini-api-model-table-grid`, so a row/column reader sees the label cell
 * ("Token limits") next to one blob containing every value. Match on the
 * section's own <b> label instead.
 */
function parseModelDetail(html: string): ModelDetail {
  const $ = cheerio.load(html);
  const detail: ModelDetail = { contextWindow: null, maxOutput: null, capabilities: {} };

  $("td.gemini-api-model-table-grid section").each((_, el) => {
    const section = $(el);
    const label = section.find("b").first().text().replace(/\s+/g, " ").trim();
    if (!label) return;
    // The value is the first <p> that is not the label's own paragraph.
    const value = section
      .find("p")
      .filter((__, pEl) => $(pEl).find("b").length === 0)
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return;

    const lower = label.toLowerCase();
    if (lower === "input token limit") detail.contextWindow = parseCount(value);
    else if (lower === "output token limit") detail.maxOutput = parseCount(value);
    else if (/^(supported|not supported)$/i.test(value)) {
      detail.capabilities[capabilityKey(label)] = /^supported$/i.test(value);
    }
  });

  return detail;
}

/** Best-effort detail fetch — a miss leaves the columns null, never throws. */
async function fetchModelDetail(slug: string): Promise<ModelDetail> {
  try {
    const res = await fetchConditional(MODEL_DETAIL_URL(slug), `${SOURCE_KEY}_detail_${slug}`);
    if (!res.body) return EMPTY_DETAIL;
    return parseModelDetail(res.body);
  } catch {
    return EMPTY_DETAIL;
  }
}

interface ParsedModel {
  id: string;
  displayName: string;
  description: string | null;
  releaseStage: string | null;
}

function slugFromHref(href: string): string | null {
  const m = href.match(/\/models\/([a-z0-9.\-_]+)/i);
  return m ? m[1]!.toLowerCase() : null;
}

function parseModelCards(html: string): ParsedModel[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: ParsedModel[] = [];

  $('a[href*="/gemini-api/docs/models/"]').each((_, el) => {
    const a = $(el);
    const href = a.attr("href");
    if (!href) return;
    const slug = slugFromHref(href);
    if (!slug || seen.has(slug)) return;

    const h3 = a.find("h3").first();
    const displayName = (h3.attr("data-text") || h3.text() || "").replace(/\s+/g, " ").trim();
    if (!displayName) return;
    seen.add(slug);

    const description =
      a.find(".description-centered").first().text().replace(/\s+/g, " ").trim() || null;
    const releaseStage =
      a.find(".status-subtext").first().text().replace(/\s+/g, " ").trim() || null;

    out.push({ id: slug, displayName, description, releaseStage });
  });

  return out;
}

export async function runGeminiModels(): Promise<RunResult> {
  const res = await fetchConditional(MODELS_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] models page returned ${res.status} — skipping`);
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }

  const parsed = parseModelCards(res.body);
  if (parsed.length === 0) {
    // Fail soft — Google's docs layout is fragile; don't error the poller.
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] parsed 0 model cards — docs layout likely changed; skipping (no data wiped)`);
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped", etag: res.etag, lastModified: res.lastModified };
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const ids = parsed.map((m) => m.id);
  const existingIds = new Set(
    (
      await db
        .select({ id: models.id })
        .from(models)
        // Provider predicate: models.id is NOT provider-namespaced (Phase 2.2
        // decision — not re-namespaced this phase). Without this, a future
        // cross-provider id collision (e.g. another provider also has a model
        // slug "pro") would let us read/overwrite that provider's row. The
        // provider predicate is the lower-risk enforcement vs. re-namespacing.
        .where(and(inArray(models.id, ids), eq(models.provider, PROVIDER)))
    ).map((r) => r.id),
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
        contextWindow: null,
        maxOutput: null,
        pricingIn: null,
        pricingOut: null,
        capabilities: {},
        firstSeenAt: now,
        lastSeenAt: now,
        provider: PROVIDER,
      })),
    );
    inserted = newModels.length;

    await db
      .insert(events)
      .values(
        newModels.map((m) => ({
          source: SOURCE_KEY,
          type: "new_model",
          externalId: m.id,
          title: `New model: ${m.displayName}`,
          bodyMd:
            `Model: \`${m.id}\`${m.releaseStage ? ` (${m.releaseStage})` : ""}` +
            (m.description ? `\n\n${m.description}` : "") +
            `\n\nListed on the Gemini API models page as of ${now.toISOString().slice(0, 10)}.`,
          url: `${MODELS_URL}#${m.id}`,
          publishedAt: now,
          provider: PROVIDER,
        })),
      )
      .onConflictDoNothing({ target: [events.source, events.externalId] });
  }

  for (const m of updatedModels) {
    await db
      .update(models)
      .set({ displayName: m.displayName, lastSeenAt: now })
      // Provider predicate (see existence query above) so we can never update
      // another provider's model row on a cross-provider id collision.
      .where(and(eq(models.id, m.id), eq(models.provider, PROVIDER)));
    updated++;
  }

  // Enrich rows that still have no token limits with data from their detail
  // page. Bounded, and a no-op once every listed model has been filled in.
  const needsLimits = await db
    .select({ id: models.id })
    .from(models)
    .where(
      and(
        eq(models.provider, PROVIDER),
        inArray(models.id, ids),
        isNull(models.contextWindow),
      ),
    )
    .limit(MAX_DETAIL_FETCHES);

  let enriched = 0;
  for (const row of needsLimits) {
    const detail = await fetchModelDetail(row.id);
    if (detail.contextWindow === null && detail.maxOutput === null) continue;
    await db
      .update(models)
      .set({
        contextWindow: detail.contextWindow,
        maxOutput: detail.maxOutput,
        ...(Object.keys(detail.capabilities).length > 0
          ? { capabilities: detail.capabilities }
          : {}),
        lastSeenAt: now,
      })
      .where(and(eq(models.id, row.id), eq(models.provider, PROVIDER)));
    enriched++;
  }
  if (enriched > 0) {
    // eslint-disable-next-line no-console
    console.log(`[${SOURCE_KEY}] enriched ${enriched} model(s) with token limits`);
  }

  return {
    inserted,
    updated: updated + enriched,
    skipped: 0,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const geminiModelsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 3,
  run: runGeminiModels,
};
