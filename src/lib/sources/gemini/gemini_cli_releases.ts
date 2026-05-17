// Polls GitHub's /repos/google-gemini/gemini-cli/releases endpoint.
// Mirrors claude/github_releases.ts including the rich release-notes body —
// the Gemini CLI repo ships substantive release bodies, so we store bodyMd.
// Uses GITHUB_TOKEN if set (5000/hr); otherwise unauthenticated (60/hr).

import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_cli_releases";
const PROVIDER: Provider = "gemini";
const REPO = "google-gemini/gemini-cli";

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

export async function runGeminiCliReleases(): Promise<RunResult> {
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
    bodyMd: rel.body ?? null,
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

export const geminiCliReleasesSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runGeminiCliReleases,
};
