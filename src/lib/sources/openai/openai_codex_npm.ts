// Polls the npm registry for new @openai/codex versions.
// Emits one event per unseen version. Mirrors claude/npm_claude_code.ts.

import { z } from "zod";
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

// The full @openai/codex packument is ~12 MB (3,889 published versions) and grows
// with every release, so it blew past the 10 MB default body cap — every run for
// weeks reported the misleading "npm registry returned status 200". The full
// document is the ONLY one that carries the `time` map we date releases from
// (the abbreviated packument omits it), so raise the cap for this source rather
// than dropping publish dates.
const MAX_BODY_BYTES = 48 * 1024 * 1024;

// @openai/codex publishes a per-platform artifact for every release
// ("0.148.0-linux-x64", "0.148.0-darwin-arm64", ...). They are the same release,
// so keeping them would push real versions off the ladder and out of MAX_VERSIONS.
const PLATFORM_SUFFIX_RE = /-(?:darwin|linux|win32)-(?:x64|arm64)$/;

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

export async function runOpenaiCodexNpm(): Promise<RunResult> {
  const res = await fetchConditional(REGISTRY_URL, SOURCE_KEY, { maxBodyBytes: MAX_BODY_BYTES });

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (res.oversized) {
    throw new Error(
      `npm registry body exceeded the ${MAX_BODY_BYTES}-byte cap for this source — raise MAX_BODY_BYTES or narrow the request`,
    );
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
    .filter((k) => !PLATFORM_SUFFIX_RE.test(k))
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
