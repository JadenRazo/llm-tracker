// Polls the npm registry for new @openai/codex versions.
// Emits one event per unseen version. Mirrors claude/npm_claude_code.ts.

import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "openai_codex_npm";
const PROVIDER: Provider = "openai";
const REGISTRY_URL = "https://registry.npmjs.org/@openai/codex";
const MAX_VERSIONS = 50;

interface NpmMetadata {
  name: string;
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, unknown>;
}

export async function runOpenaiCodexNpm(): Promise<RunResult> {
  const res = await fetchConditional(REGISTRY_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`npm registry returned status ${res.status}`);
  }

  let data: NpmMetadata;
  try {
    data = JSON.parse(res.body) as NpmMetadata;
  } catch {
    throw new Error("npm registry returned non-JSON body");
  }

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
    url: `https://www.npmjs.com/package/@openai/codex/v/${version}`,
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

export const openaiCodexNpmSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 1,
  run: runOpenaiCodexNpm,
};
