// Polls status.claude.com for current status + active/recent incidents.
// - Upserts one "current_status" event that reflects the aggregate indicator.
// - Upserts one event per incident id.

import { and, eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "anthropic_status";
const PROVIDER: Provider = "claude";
const SUMMARY_URL = "https://status.claude.com/api/v2/summary.json";

interface StatusSummary {
  page?: { url?: string };
  status?: { indicator?: string; description?: string };
  incidents?: StatusIncident[];
  scheduled_maintenances?: StatusIncident[];
}

interface StatusIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  incident_updates?: { body: string; created_at: string; status: string }[];
}

function renderIncidentBody(incident: StatusIncident): string {
  const updates = incident.incident_updates ?? [];
  const lines = updates
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((u) => `- **${u.status}** (${u.created_at}): ${u.body.trim()}`);
  return [`_Impact: ${incident.impact} · Status: ${incident.status}_`, "", ...lines].join("\n");
}

export async function runAnthropicStatus(): Promise<RunResult> {
  const res = await fetchConditional(SUMMARY_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`status.claude.com returned status ${res.status}`);
  }

  let data: StatusSummary;
  try {
    data = JSON.parse(res.body) as StatusSummary;
  } catch {
    throw new Error("status.claude.com returned non-JSON body");
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  let inserted = 0;
  let updated = 0;

  // ---- current overall status ----
  const indicator = data.status?.indicator ?? "unknown";
  const description = data.status?.description ?? "Unknown";
  const currentTitle = `Status: ${description}`;
  const currentBody = `Indicator: **${indicator}**`;
  const existingCurrent = await db
    .select({ id: events.id, title: events.title, bodyMd: events.bodyMd })
    .from(events)
    .where(and(eq(events.source, SOURCE_KEY), eq(events.externalId, "current")))
    .limit(1);

  if (existingCurrent.length === 0) {
    await db.insert(events).values({
      source: SOURCE_KEY,
      type: "status",
      externalId: "current",
      title: currentTitle,
      bodyMd: currentBody,
      url: "https://status.claude.com",
      provider: PROVIDER,
    });
    inserted++;
  } else if (existingCurrent[0]!.title !== currentTitle || existingCurrent[0]!.bodyMd !== currentBody) {
    await db
      .update(events)
      .set({ title: currentTitle, bodyMd: currentBody, detectedAt: new Date() })
      .where(eq(events.id, existingCurrent[0]!.id));
    updated++;
  }

  // ---- incidents (active + scheduled) ----
  const allIncidents: StatusIncident[] = [
    ...(data.incidents ?? []),
    ...(data.scheduled_maintenances ?? []),
  ];

  if (allIncidents.length > 0) {
    const ids = allIncidents.map((i) => i.id);
    const priorRows = await db
      .select({ id: events.id, externalId: events.externalId, bodyMd: events.bodyMd })
      .from(events)
      .where(and(eq(events.source, SOURCE_KEY), inArray(events.externalId, ids)));
    const prior = new Map(priorRows.map((r) => [r.externalId, { id: r.id, bodyMd: r.bodyMd }]));

    const toInsert: Array<typeof events.$inferInsert> = [];
    const toUpdate: Array<{ id: number; body: string }> = [];

    for (const incident of allIncidents) {
      const body = renderIncidentBody(incident);
      const url = incident.shortlink ?? "https://status.claude.com";
      const existing = prior.get(incident.id);
      if (!existing) {
        toInsert.push({
          source: SOURCE_KEY,
          type: "incident",
          externalId: incident.id,
          title: incident.name,
          bodyMd: body,
          url,
          publishedAt: new Date(incident.created_at),
          provider: PROVIDER,
        });
      } else if (existing.bodyMd !== body) {
        toUpdate.push({ id: existing.id, body });
      }
    }

    if (toInsert.length > 0) {
      const insertedRows = await db
        .insert(events)
        .values(toInsert)
        .onConflictDoNothing({ target: [events.source, events.externalId] })
        .returning({ id: events.id });
      inserted += insertedRows.length;
    }
    for (const u of toUpdate) {
      await db.update(events).set({ bodyMd: u.body, detectedAt: new Date() }).where(eq(events.id, u.id));
      updated++;
    }
  }

  return {
    inserted,
    updated,
    skipped: 0,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const anthropicStatusSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 1,
  run: runAnthropicStatus,
};
