// Polls GitHub's /repos/openai/codex/releases endpoint.
// Mirrors claude/github_releases.ts (auth + per-key ETag), but per the
// Phase 2.2 decision the Codex release bodies are ~empty, so we store only
// version/tag + a link to the GitHub release + the published date. We do NOT
// fabricate a notes body — bodyMd stays null.
// Uses GITHUB_TOKEN if set (5000/hr); otherwise unauthenticated (60/hr).

import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "openai_codex_releases";
const PROVIDER: Provider = "openai";
const REPO = "openai/codex";

interface GithubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
}

export async function runOpenaiCodexReleases(): Promise<RunResult> {
  const token = env().GITHUB_TOKEN;
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetchConditional(url, SOURCE_KEY, { headers });

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`${REPO} releases returned status ${res.status}`);
  }

  let releases: GithubRelease[];
  try {
    releases = JSON.parse(res.body) as GithubRelease[];
  } catch {
    throw new Error(`${REPO} releases returned non-JSON body`);
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const publishable = releases.filter((r) => !r.draft);
  const draftSkipped = releases.length - publishable.length;
  if (publishable.length === 0) {
    return { inserted: 0, updated: 0, skipped: draftSkipped, status: "ok", etag: res.etag, lastModified: res.lastModified };
  }

  const rows = publishable.map((rel) => ({
    source: SOURCE_KEY,
    type: rel.prerelease ? "prerelease" : "release",
    externalId: `${REPO}:${rel.tag_name}`,
    title: rel.name && rel.name.trim().length > 0 ? rel.name : `${REPO} ${rel.tag_name}`,
    // Codex release bodies are effectively empty — store only the link, no
    // synthesized notes (Phase 2.2 user decision).
    bodyMd: null,
    url: rel.html_url,
    publishedAt: rel.published_at ? new Date(rel.published_at) : new Date(rel.created_at),
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
    skipped: draftSkipped + (publishable.length - inserted.length),
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const openaiCodexReleasesSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runOpenaiCodexReleases,
};
