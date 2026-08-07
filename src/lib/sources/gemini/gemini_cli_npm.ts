// Polls the npm registry for new @google/gemini-cli versions.
// Emits one event per unseen version. Mirrors claude/npm_claude_code.ts.

import { z } from "zod";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_cli_npm";
const PROVIDER: Provider = "gemini";
const REGISTRY_URL = "https://registry.npmjs.org/@google/gemini-cli";
const MAX_VERSIONS = 50;

// npm registry is untrusted upstream — validate the shape before we read it.
// .passthrough() so the registry's many extra fields don't reject a valid doc.
const npmMetadataSchema = z
  .object({
    name: z.string(),
    "dist-tags": z.record(z.string()).optional(),
    time: z.record(z.string()).optional(),
    versions: z.record(z.unknown()).optional(),
  })
  .passthrough();

type NpmMetadata = z.infer<typeof npmMetadataSchema>;

export async function runGeminiCliNpm(): Promise<RunResult> {
  const res = await fetchConditional(REGISTRY_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`npm registry returned status ${res.status}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    throw new Error("npm registry returned non-JSON body");
  }

  const parsed = npmMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${SOURCE_KEY}] npm metadata failed schema validation — skipping:`,
      parsed.error.issues.slice(0, 3),
    );
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }
  const data: NpmMetadata = parsed.data;

  const db = tryGetDb();
  if (!db) {
    return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };
  }

  const time = data.time ?? {};
  // "created" and "modified" are metadata keys in the time map — filter them out.
  const versions = Object.keys(time)
    .filter((k) => k !== "created" && k !== "modified")
    .filter((k) => /^\d+\.\d+\.\d+/.test(k))
    .sort((a, b) => new Date(time[b]!).getTime() - new Date(time[a]!).getTime())
    .slice(0, MAX_VERSIONS);

  if (versions.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const rows = versions.map((version) => ({
    source: SOURCE_KEY,
    type: "release",
    externalId: version,
    title: `v${version}`,
    bodyMd: null,
    url: `https://www.npmjs.com/package/@google/gemini-cli/v/${version}`,
    publishedAt: time[version] ? new Date(time[version]!) : null,
    provider: PROVIDER,
  }));

  const inserted = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  return {
    inserted: inserted.length,
    updated: 0,
    skipped: versions.length - inserted.length,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const geminiCliNpmSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 1,
  run: runGeminiCliNpm,
};
