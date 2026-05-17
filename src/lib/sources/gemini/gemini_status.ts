// Tier 2 (30m, deliberate): this proxies the broad GCP incidents.json feed
// (all of Google Cloud, not a dedicated Gemini Statuspage). 30m rather than 10m
// is a deliberate cost/noise tradeoff — the feed is large and most incidents
// are non-AI and filtered out, so a tighter cadence buys little freshness for
// the extra fetch/parse cost.
//
// Polls status.cloud.google.com/incidents.json and emits one event per
// AI/Gemini-relevant incident. This is the user-approved provider-level status
// substitute for Gemini (Google has no dedicated Gemini Statuspage).
//
// The feed covers all of GCP, so we filter conservatively: keep an incident
// only if any of its affected_products[].title matches a known AI surface
// (Gemini / Generative AI / Vertex AI / Dialogflow / Agent / AI Studio). What
// we drop vs. keep is logged so over/under-filtering is debuggable. Body deduped
// via contentHash (each incident's `updates` array changes as it progresses).

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional, sha256Hex } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_status";
const PROVIDER: Provider = "gemini";
const INCIDENTS_URL = "https://status.cloud.google.com/incidents.json";
const STATUS_PAGE = "https://status.cloud.google.com";

// Cap incidents persisted per run. incidents.json is the full GCP history and
// can be large; we only ever persist the AI-relevant subset, but bound it so a
// malformed/hostile feed can't drive an unbounded batch insert.
const MAX_INCIDENTS = 200;

// Conservative product-name allowlist (substring, case-insensitive). Anchored
// to the AI surfaces that touch Gemini; deliberately excludes generic infra
// (Cloud Storage, IAM, etc.) even when implicated in an AI incident.
const AI_PRODUCT_PATTERNS = [
  "gemini",
  "generative ai",
  "vertex ai",
  "ai studio",
  "dialogflow",
  "agent assist",
  "agent builder",
  "contact center ai",
];

// Upstream incidents.json is untrusted. Validate the shape we read before
// touching the DB; on failure we soft-skip (never throw, never write).
// .passthrough() keeps the schema tolerant of GCP's many extra fields.
const gcpUpdateSchema = z
  .object({
    created: z.string().optional(),
    modified: z.string().optional(),
    when: z.string().optional(),
    text: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const gcpIncidentSchema = z
  .object({
    id: z.string(),
    number: z.string().optional(),
    begin: z.string().optional(),
    created: z.string().optional(),
    end: z.string().nullable().optional(),
    modified: z.string().optional(),
    external_desc: z.string().optional(),
    uri: z.string().optional(),
    most_recent_update: gcpUpdateSchema.optional(),
    affected_products: z
      .array(
        z.object({ title: z.string().optional(), id: z.string().optional() }).passthrough(),
      )
      .optional(),
    updates: z.array(gcpUpdateSchema).optional(),
  })
  .passthrough();

const gcpIncidentsSchema = z.array(gcpIncidentSchema);

type GcpIncident = z.infer<typeof gcpIncidentSchema>;

function isAiRelevant(incident: GcpIncident): boolean {
  const products = incident.affected_products ?? [];
  return products.some((p) => {
    const title = (p.title ?? "").toLowerCase();
    return AI_PRODUCT_PATTERNS.some((pat) => title.includes(pat));
  });
}

function renderBody(incident: GcpIncident): string {
  const products = (incident.affected_products ?? [])
    .map((p) => p.title)
    .filter(Boolean)
    .join(", ");
  const updates = (incident.updates ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created ?? a.when ?? 0).getTime() - new Date(b.created ?? b.when ?? 0).getTime(),
    )
    .map((u) => `- **${u.status ?? "update"}** (${u.created ?? u.when ?? "?"}): ${(u.text ?? "").trim()}`);
  return [
    `_Affected: ${products || "unknown"}${incident.end ? " · Resolved" : " · Ongoing"}_`,
    incident.external_desc ? `\n${incident.external_desc}` : "",
    "",
    ...updates,
  ].join("\n");
}

export async function runGeminiStatus(): Promise<RunResult> {
  const res = await fetchConditional(INCIDENTS_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] incidents.json returned ${res.status} — skipping`);
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] incidents.json non-JSON body — skipping`);
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }

  const validated = gcpIncidentsSchema.safeParse(raw);
  if (!validated.success) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${SOURCE_KEY}] incidents.json failed schema validation — skipping:`,
      validated.error.issues.slice(0, 3),
    );
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }
  const all: GcpIncident[] = validated.data;

  // Cap the AI-relevant set before insert so a malformed/hostile feed can't
  // drive an unbounded batch (see MAX_INCIDENTS).
  const relevant = all.filter(isAiRelevant).slice(0, MAX_INCIDENTS);
  // eslint-disable-next-line no-console
  console.log(
    `[${SOURCE_KEY}] ${all.length} GCP incidents total, ${relevant.length} AI-relevant kept (${
      all.length - relevant.length
    } non-AI filtered out)`,
  );

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  if (relevant.length === 0) {
    return { inserted: 0, updated: 0, skipped: all.length, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const ids = relevant.map((i) => i.id);
  const priorRows = await db
    .select({ id: events.id, externalId: events.externalId, contentHash: events.contentHash })
    .from(events)
    .where(and(eq(events.source, SOURCE_KEY), inArray(events.externalId, ids)));
  const prior = new Map(priorRows.map((r) => [r.externalId, { id: r.id, contentHash: r.contentHash }]));

  const toInsert: Array<typeof events.$inferInsert> = [];
  const toUpdate: Array<{ id: number; body: string; hash: string }> = [];

  for (const incident of relevant) {
    const body = renderBody(incident);
    const hash = sha256Hex(body);
    const url = incident.uri ? `${STATUS_PAGE}/${incident.uri.replace(/^\//, "")}` : STATUS_PAGE;
    const existing = prior.get(incident.id);
    if (!existing) {
      // Guard against a malformed upstream date (siblings fall back to null
      // and let detectedAt stand in).
      const rawDate = incident.begin ?? incident.created ?? null;
      const d = rawDate ? new Date(rawDate) : null;
      const publishedAt = d && !Number.isNaN(d.getTime()) ? d : null;
      toInsert.push({
        source: SOURCE_KEY,
        type: "incident",
        externalId: incident.id,
        title: incident.external_desc ?? `GCP AI incident ${incident.number ?? incident.id}`,
        bodyMd: body,
        url,
        contentHash: hash,
        publishedAt,
        provider: PROVIDER,
      });
    } else if (existing.contentHash !== hash) {
      toUpdate.push({ id: existing.id, body, hash });
    }
  }

  let inserted = 0;
  let updated = 0;

  if (toInsert.length > 0) {
    const insertedRows = await db
      .insert(events)
      .values(toInsert)
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({ id: events.id });
    inserted = insertedRows.length;
  }
  for (const u of toUpdate) {
    await db
      .update(events)
      .set({ bodyMd: u.body, contentHash: u.hash, detectedAt: new Date() })
      .where(eq(events.id, u.id));
    updated++;
  }

  return {
    inserted,
    updated,
    skipped: all.length - relevant.length,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const geminiStatusSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  // Tier 2 (30m): broad GCP incidents.json feed — deliberate 30m cadence (see
  // file header for the cost/noise rationale).
  tier: 2,
  run: runGeminiStatus,
};
