// Builds the OpenAI model catalog from developers.openai.com's MARKDOWN docs.
//
// Until now `models` held zero OpenAI rows and /openai/models rendered
// "The tracker has no OpenAI model-catalog source it can poll". OpenAI publishes
// no unauthenticated catalog API, but its docs site serves a markdown twin of
// every page by appending `.md`, and those are far more stable to parse than the
// rendered HTML (the HTML page shows only three featured cards and puts the rest
// behind client-side rendering).
//
//   index:  /api/docs/models.md            -> [Display Name](/api/docs/models/<id>.md) x ~96
//   detail: /api/docs/models/<id>.md       -> "## Model details" bullets + a pricing table
//
// A detail page gives context window, max output tokens, modalities, reasoning
// support and per-1M-token pricing — more than either sibling provider source
// exposes. Non-LLM models (embeddings, TTS, transcription, image) legitimately
// omit context/max-output; that is recorded as null rather than guessed.
//
// models.id namespacing follows gemini_models: the bare upstream slug, with every
// read and write provider-scoped so a cross-provider id collision can never read
// or overwrite another provider's row.

import { and, eq, inArray, sql } from "drizzle-orm";
import { tryGetDb, type Database } from "@/lib/db";
import { events, models } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "openai_models";
const PROVIDER: Provider = "openai";
const DOCS_BASE = "https://developers.openai.com/api/docs/models";
const INDEX_URL = `${DOCS_BASE}.md`;
const DETAIL_URL = (id: string) => `${DOCS_BASE}/${id}.md`;

/** Detail fetches per run. ~96 models fill in over a few tier-3 ticks, then this is a no-op. */
const MAX_DETAIL_FETCHES = 25;
/** Below this the index markup has changed; fail soft rather than wiping the catalog. */
const MIN_EXPECTED_MODELS = 20;

interface ParsedModel {
  id: string;
  displayName: string;
}

interface ModelDetail {
  contextWindow: number | null;
  maxOutput: number | null;
  pricingIn: string | null;
  pricingOut: string | null;
  capabilities: Record<string, boolean>;
}

const EMPTY_DETAIL: ModelDetail = {
  contextWindow: null,
  maxOutput: null,
  pricingIn: null,
  pricingOut: null,
  capabilities: {},
};

/** "1,050,000" -> 1050000 */
function parseCount(raw: string): number | null {
  const n = Number.parseInt(raw.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Index markdown lists every model as `[Display Name](/api/docs/models/<id>.md)`.
 * First occurrence wins — the page repeats recommended models in a lead-in
 * paragraph before the full list.
 */
export function parseModelIndex(md: string): ParsedModel[] {
  const seen = new Map<string, string>();
  const re = /\[([^\]]+)\]\(\/api\/docs\/models\/([a-z0-9][a-z0-9.\-]*)\.md\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const id = m[2]!.toLowerCase();
    const displayName = m[1]!.replace(/\s+/g, " ").trim();
    if (!displayName || seen.has(id)) continue;
    seen.set(id, displayName);
  }
  return [...seen].map(([id, displayName]) => ({ id, displayName }));
}

/**
 * Detail markdown. The "## Model details" bullets are prose-shaped
 * ("- 1,050,000 context window"), and pricing is a table whose Input/Output rows
 * we read only when the unit is per-1M-tokens — image and audio models price per
 * image or per minute, and mixing units into one numeric column would be a lie.
 */
export function parseModelDetail(md: string): ModelDetail {
  const detail: ModelDetail = { ...EMPTY_DETAIL, capabilities: {} };

  const context = md.match(/^-\s+([\d,]+)\s+context window\s*$/im);
  if (context) detail.contextWindow = parseCount(context[1]!);

  const maxOut = md.match(/^-\s+([\d,]+)\s+max output tokens\s*$/im);
  if (maxOut) detail.maxOutput = parseCount(maxOut[1]!);

  const inputModalities = md.match(/^-\s+Input modalities:\s*(.+)$/im)?.[1] ?? "";
  const outputModalities = md.match(/^-\s+Output modalities:\s*(.+)$/im)?.[1] ?? "";
  const has = (list: string, kind: string) =>
    list.toLowerCase().split(",").map((x) => x.trim()).includes(kind);

  if (has(inputModalities, "image")) detail.capabilities.vision = true;
  if (has(inputModalities, "audio")) detail.capabilities.audioInput = true;
  if (has(outputModalities, "image")) detail.capabilities.imageGeneration = true;
  if (has(outputModalities, "audio")) detail.capabilities.audioGeneration = true;
  if (/^-\s+Reasoning token support\s*$/im.test(md)) detail.capabilities.reasoning = true;

  // Endpoint support table -> the tool-ish capabilities the UI already labels.
  if (/\|\s*Batch\s*\|[^|]*\|\s*Supported\s*\|/i.test(md)) detail.capabilities.batchApi = true;
  if (/\|\s*Realtime\s*\|[^|]*\|\s*Supported\s*\|/i.test(md)) detail.capabilities.liveApi = true;
  if (/\|\s*Fine-tuning\s*\|[^|]*\|\s*Supported\s*\|/i.test(md)) detail.capabilities.fineTuning = true;

  // Only per-1M-token prices; anything else is a different unit.
  const price = (label: string): string | null => {
    const re = new RegExp(`^\\|\\s*${label}\\s*\\|\\s*\\$([\\d.]+)\\s*\\|\\s*1M tokens\\s*\\|`, "im");
    const hit = md.match(re);
    if (!hit) return null;
    const n = Number.parseFloat(hit[1]!);
    return Number.isFinite(n) ? n.toFixed(4) : null;
  };
  detail.pricingIn = price("Input");
  detail.pricingOut = price("Output");

  return detail;
}

/** Best-effort detail fetch — a miss leaves the row unenriched, never throws. */
async function fetchModelDetail(id: string): Promise<ModelDetail | null> {
  try {
    const res = await fetchConditional(DETAIL_URL(id), `${SOURCE_KEY}_detail_${id}`);
    if (!res.body) return null;
    return parseModelDetail(res.body);
  } catch {
    return null;
  }
}

/**
 * Fill in specs for rows not yet enriched.
 *
 * "Not enriched" is `capabilities = '{}'` rather than "contextWindow is null":
 * embeddings, TTS, transcription and image models genuinely have no context
 * window, so keying off it would re-fetch those every single run forever. Every
 * successful detail parse writes at least the modality flags, so the marker
 * flips exactly once per model.
 *
 * Deliberately independent of the index fetch, so a 304 or a transient index
 * parse failure does not stall the catalog half-filled.
 */
async function enrichUnfilled(db: Database, now: Date): Promise<number> {
  const pending = await db
    .select({ id: models.id })
    .from(models)
    .where(and(eq(models.provider, PROVIDER), sql`${models.capabilities} = '{}'::jsonb`))
    .limit(MAX_DETAIL_FETCHES);

  let enriched = 0;
  for (const row of pending) {
    const detail = await fetchModelDetail(row.id);
    if (!detail) continue;
    await db
      .update(models)
      .set({
        contextWindow: detail.contextWindow,
        maxOutput: detail.maxOutput,
        pricingIn: detail.pricingIn,
        pricingOut: detail.pricingOut,
        // Always non-empty on a successful parse, so this row is not re-fetched.
        capabilities:
          Object.keys(detail.capabilities).length > 0 ? detail.capabilities : { documented: true },
        lastSeenAt: now,
      })
      .where(and(eq(models.id, row.id), eq(models.provider, PROVIDER)));
    enriched++;
  }
  if (enriched > 0) {
    // eslint-disable-next-line no-console
    console.log(`[${SOURCE_KEY}] enriched ${enriched} model(s) from their detail pages`);
  }
  return enriched;
}

export async function runOpenaiModels(): Promise<RunResult> {
  const res = await fetchConditional(INDEX_URL, SOURCE_KEY);
  const now = new Date();

  if (res.unchanged) {
    const dbUnchanged = tryGetDb();
    const toppedUp = dbUnchanged ? await enrichUnfilled(dbUnchanged, now) : 0;
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
    console.warn(`[${SOURCE_KEY}] models.md returned ${res.status} — skipping`);
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }

  const parsed = parseModelIndex(res.body);
  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  if (parsed.length < MIN_EXPECTED_MODELS) {
    // Fail soft: a docs restructure must not wipe or truncate the catalog.
    // eslint-disable-next-line no-console
    console.warn(
      `[${SOURCE_KEY}] parsed only ${parsed.length} models from ${INDEX_URL} (< ${MIN_EXPECTED_MODELS}) — markup likely changed; skipping (no data wiped)`,
    );
    const toppedUp = await enrichUnfilled(db, now);
    return { inserted: 0, updated: toppedUp, skipped: 1, status: "skipped", etag: res.etag, lastModified: res.lastModified };
  }

  const ids = parsed.map((m) => m.id);
  const existing = new Set(
    (
      await db
        .select({ id: models.id })
        .from(models)
        // Provider predicate: models.id is the bare upstream slug, so without
        // this a shared slug could read another provider's row.
        .where(and(inArray(models.id, ids), eq(models.provider, PROVIDER)))
    ).map((r) => r.id),
  );

  const newModels = parsed.filter((m) => !existing.has(m.id));
  const seenModels = parsed.filter((m) => existing.has(m.id));

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

    await db
      .insert(events)
      .values(
        newModels.map((m) => ({
          source: SOURCE_KEY,
          type: "new_model",
          externalId: m.id,
          title: `New model: ${m.displayName}`,
          bodyMd:
            `Model: \`${m.id}\`\n\nListed on the OpenAI API models page as of ` +
            `${now.toISOString().slice(0, 10)}.`,
          url: `${DOCS_BASE}/${m.id}`,
          publishedAt: now,
          provider: PROVIDER,
        })),
      )
      .onConflictDoNothing({ target: [events.source, events.externalId] });
  }

  for (const m of seenModels) {
    await db
      .update(models)
      .set({ displayName: m.displayName, lastSeenAt: now })
      .where(and(eq(models.id, m.id), eq(models.provider, PROVIDER)));
  }

  const enriched = await enrichUnfilled(db, now);

  return {
    inserted: newModels.length,
    updated: seenModels.length + enriched,
    skipped: 0,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const openaiModelsSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 3,
  run: runOpenaiModels,
};
