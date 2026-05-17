// Polls GitHub's /repos/{repo}/releases endpoint for a set of Anthropic repos.
// Uses GITHUB_TOKEN if set (5000/hr); otherwise unauthenticated (60/hr).

import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor, SourceKey } from "@/lib/sources/registry";

const PROVIDER: Provider = "claude";

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

function runFactory(repo: string, sourceKey: string) {
  return async function run(): Promise<RunResult> {
    const token = env().GITHUB_TOKEN;
    const url = `https://api.github.com/repos/${repo}/releases?per_page=20`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetchConditional(url, sourceKey, { headers });

    if (res.unchanged) {
      return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
    }
    if (!res.body || res.status >= 400) {
      throw new Error(`${repo} releases returned status ${res.status}`);
    }

    let releases: GithubRelease[];
    try {
      releases = JSON.parse(res.body) as GithubRelease[];
    } catch {
      throw new Error(`${repo} releases returned non-JSON body`);
    }

    const db = tryGetDb();
    if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

    const publishable = releases.filter((r) => !r.draft);
    const draftSkipped = releases.length - publishable.length;
    if (publishable.length === 0) {
      return { inserted: 0, updated: 0, skipped: draftSkipped, status: "ok", etag: res.etag, lastModified: res.lastModified };
    }

    const rows = publishable.map((rel) => ({
      source: sourceKey,
      type: rel.prerelease ? "prerelease" : "release",
      externalId: `${repo}:${rel.tag_name}`,
      title: rel.name && rel.name.trim().length > 0 ? rel.name : `${repo} ${rel.tag_name}`,
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
  };
}

// Pre-bound descriptors — one per tracked repo. Each uses its own sourceKey so
// that ETags are cached per-repo (they'd thrash if shared). All Tier 2.
function githubReleasesSource(repo: string, sourceKey: SourceKey): SourceDescriptor {
  return { key: sourceKey, provider: PROVIDER, tier: 2, run: runFactory(repo, sourceKey) };
}

export const githubReleasesClaudeCodeSource = githubReleasesSource(
  "anthropics/claude-code",
  "github_releases_claude_code",
);
export const githubReleasesSdkPythonSource = githubReleasesSource(
  "anthropics/anthropic-sdk-python",
  "github_releases_sdk_python",
);
export const githubReleasesSdkTypescriptSource = githubReleasesSource(
  "anthropics/anthropic-sdk-typescript",
  "github_releases_sdk_typescript",
);
export const githubReleasesSdkGoSource = githubReleasesSource(
  "anthropics/anthropic-sdk-go",
  "github_releases_sdk_go",
);
export const githubReleasesAgentSdkPythonSource = githubReleasesSource(
  "anthropics/claude-agent-sdk-python",
  "github_releases_agent_sdk_python",
);
