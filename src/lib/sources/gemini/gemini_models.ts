// Reads the Gemini API model lineup and upserts into `models`.
//
// Google moved these docs from ai.google.dev (server-rendered HTML) to
// aistudio.google.com/docs in November 2026. The old URL now answers 301 and
// the new pages are Markdoc, served as Markdown at `<page>.md`. The lineup has
// two card forms:
//   {% card description="…" title="Gemini 4 Carbon" variant="model-card" %}
//     … *Model code* **gemini-4-carbon** …
//     {% button href="/docs/models/gemini-4-carbon" … /%}
//   {% /card %}
//   {% card badge="Stable" description="…" href="/docs/models/gemini-3.8-flash"
//      title="Gemini 3.8 Flash" variant="model" /%}
// The new pages send no ETag or Last-Modified, so this source always re-reads
// the lineup and never reports "unchanged".
// Rows stay keyed by the docs slug in the card's link, as they always were, so
// models already in the table are matched rather than announced again. The
// page's "All models" endpoint tables are deliberately not read: they list
// dozens of old and dated endpoint codes that were never cards.
//
// The cards carry no token limits, but each model's DETAIL page
// (/docs/models/<slug>.md) has a "Token limits" row. Without it every Gemini
// row rendered "—" in every numeric column.
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

import { and, eq, inArray, isNull } from "drizzle-orm";
import { tryGetDb, type Database } from "@/lib/db";
import { events, models } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_models";
const PROVIDER: Provider = "gemini";
const DOCS_URL = "https://aistudio.google.com/docs/models";
const MODELS_URL = `${DOCS_URL}.md`;
const MODEL_DETAIL_URL = (slug: string) => `${DOCS_URL}/${slug}.md`;
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
 * Read token limits and capabilities off a model detail page (Markdown).
 *
 * Limits are bold-labelled lines in the "Token limits" row. Gemini 4 models
 * share one budget ("Context window (unified input and output token limit)" and
 * "Max output"); earlier models list "Input token limit" / "Output token limit".
 * Capabilities are `[**Name**](link)` followed by a supported/not-supported badge.
 */
export function parseModelDetail(md: string): ModelDetail {
  const detail: ModelDetail = { contextWindow: null, maxOutput: null, capabilities: {} };
  const limit = (label: string): number | null => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The first value in a table cell follows the cell's own list bullet. Take
    // the first number on the line: "65,536 (default synchronous) / up to …".
    const hit = md.match(new RegExp(`^\\s*(?:\\*\\s+)?\\*\\*${escaped}\\*\\*[ \\t]+([\\d,]+)`, "m"));
    return hit ? parseCount(hit[1]!) : null;
  };
  detail.contextWindow = limit("Context window (unified input and output token limit)") ?? limit("Input token limit");
  detail.maxOutput = limit("Max output") ?? limit("Output token limit");

  for (const hit of md.matchAll(/\[\*\*([^*\]]+)\*\*\]\([^)]*\)\s*\{% badge ([^%]*?)\/%\}/g)) {
    const type = hit[2]!.match(/type="(supported|not-supported)"/)?.[1];
    // A labelled badge qualifies the claim ("Supported (Implicit only)"), and a
    // yes/no flag would drop the qualifier, so those are not recorded. The one
    // exception lists reasoning levels, which is still plain support.
    const label = hit[2]!.match(/label=([^"]*?)\s*(?:type=|$)/)?.[1]?.trim();
    if (!type || (label && !/^Supported \((?:minimal|low|medium|high)(?:, (?:minimal|low|medium|high))*\)$/.test(label))) continue;
    detail.capabilities[capabilityKey(hit[1]!)] = type === "supported";
  }
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

function slugFromHref(href: string | undefined): string | null {
  const m = href?.match(/^\/docs\/models\/([a-z0-9.\-_]+)$/i);
  return m ? m[1]!.toLowerCase() : null;
}

const cardAttributes = (raw: string): Record<string, string | undefined> =>
  Object.fromEntries([...raw.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));

export function parseModelCards(md: string): ParsedModel[] {
  const seen = new Set<string>();
  const out: ParsedModel[] = [];
  const add = (attrs: Record<string, string | undefined>, href: string | undefined) => {
    const slug = slugFromHref(href);
    const displayName = (attrs.title ?? "").replace(/\s+/g, " ").trim();
    if (!slug || !displayName || seen.has(slug)) return;
    seen.add(slug);
    out.push({
      id: slug,
      displayName,
      description: attrs.description?.replace(/\s+/g, " ").trim() || null,
      releaseStage: attrs.badge?.trim() || null,
    });
  };

  // One pass in page order: block cards link through a button in their body,
  // self-closing cards carry the link as an attribute.
  const card = /\{% card ((?:[a-z-]+="[^"]*"\s*)+)(?:\/%\}|%\}([\s\S]*?)\{% \/card %\})/g;
  for (const hit of md.matchAll(card)) {
    const attrs = cardAttributes(hit[1]!);
    if (attrs.variant !== "model" && attrs.variant !== "model-card") continue;
    const link = hit[2] === undefined ? attrs.href : hit[2].match(/\{% button href="(\/docs\/models\/[^"]+)"/)?.[1];
    add(attrs, link);
  }
  return out;
}

/**
 * Fill in token limits + capabilities for this provider's rows that still have
 * none, by reading each model's detail page.
 *
 * Deliberately INDEPENDENT of the listing fetch. It was originally inline after
 * the card parse, which meant it only ran when the listing returned a 200 AND
 * parsed at least one card — so on a 304 (the common case, the listing changes a
 * few times a year) or a transient zero-card parse it never ran, and models that
 * missed their first enrichment stayed dashes indefinitely. This reads rows that
 * are already in the database; the listing's outcome is irrelevant to it.
 *
 * Bounded per run, and a model whose detail page 404s (several `-preview` and
 * `-image` slugs have no page) simply stays null and is retried cheaply later.
 */
async function enrichMissingLimits(db: Database, now: Date): Promise<number> {
  const needsLimits = await db
    .select({ id: models.id })
    .from(models)
    .where(and(eq(models.provider, PROVIDER), isNull(models.contextWindow)))
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
  return enriched;
}

export async function runGeminiModels(): Promise<RunResult> {
  const res = await fetchConditional(MODELS_URL, SOURCE_KEY);

  if (res.unchanged) {
    // The LISTING is unchanged; that says nothing about whether every model we
    // already hold has its token limits, so still top them up.
    const dbUnchanged = tryGetDb();
    const toppedUp = dbUnchanged ? await enrichMissingLimits(dbUnchanged, new Date()) : 0;
    return {
      inserted: 0,
      updated: toppedUp,
      skipped: 0,
      status: toppedUp > 0 ? "ok" : "unchanged",
      etag: res.etag,
      lastModified: res.lastModified,
    };
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
    const dbFallback = tryGetDb();
    const toppedUp = dbFallback ? await enrichMissingLimits(dbFallback, new Date()) : 0;
    return { inserted: 0, updated: toppedUp, skipped: 1, status: "skipped", etag: res.etag, lastModified: res.lastModified };
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
          url: `${DOCS_URL}/${m.id}`,
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

  const enriched = await enrichMissingLimits(db, now);

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
