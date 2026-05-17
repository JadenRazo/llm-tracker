// Source dispatcher: given a SourceKey, run the matching module and record the
// outcome in poller_runs.

import { tryGetDb } from "@/lib/db";
import { pollerRuns } from "@/lib/db/schema";

import { runAnthropicModels } from "@/lib/sources/anthropic_models";
import { runAnthropicNews } from "@/lib/sources/anthropic_news";
import { runAnthropicStatus } from "@/lib/sources/anthropic_status";
import { runClaudeCodeChangelog } from "@/lib/sources/claude_code_changelog";
import { runClaudeCodeReference } from "@/lib/sources/claude_code_reference";
import { runDocsReleaseNotes } from "@/lib/sources/docs_release_notes";
import {
  runGithubReleasesAgentSdkPython,
  runGithubReleasesClaudeCode,
  runGithubReleasesSdkGo,
  runGithubReleasesSdkPython,
  runGithubReleasesSdkTypescript,
} from "@/lib/sources/github_releases";
import { runMcpServers } from "@/lib/sources/mcp_servers";
import { runNpmClaudeCode } from "@/lib/sources/npm_claude_code";

export type SourceKey =
  | "npm_claude_code"
  | "anthropic_status"
  | "anthropic_models"
  | "anthropic_news"
  | "claude_code_changelog"
  | "claude_code_reference"
  | "docs_release_notes"
  | "github_releases_claude_code"
  | "github_releases_sdk_python"
  | "github_releases_sdk_typescript"
  | "github_releases_sdk_go"
  | "github_releases_agent_sdk_python"
  | "mcp_servers";

export interface RunResult {
  inserted: number;
  updated: number;
  skipped: number;
  /** "ok" | "unchanged" | "skipped" — anything that isn't a thrown error. */
  status?: "ok" | "unchanged" | "skipped";
  etag?: string;
  lastModified?: string;
  lastSeenHash?: string;
}

type SourceFn = () => Promise<RunResult>;

const SOURCES: Record<SourceKey, SourceFn> = {
  npm_claude_code: runNpmClaudeCode,
  anthropic_status: runAnthropicStatus,
  anthropic_models: runAnthropicModels,
  anthropic_news: runAnthropicNews,
  claude_code_changelog: runClaudeCodeChangelog,
  claude_code_reference: runClaudeCodeReference,
  docs_release_notes: runDocsReleaseNotes,
  github_releases_claude_code: runGithubReleasesClaudeCode,
  github_releases_sdk_python: runGithubReleasesSdkPython,
  github_releases_sdk_typescript: runGithubReleasesSdkTypescript,
  github_releases_sdk_go: runGithubReleasesSdkGo,
  github_releases_agent_sdk_python: runGithubReleasesAgentSdkPython,
  mcp_servers: runMcpServers,
};

export function isSourceKey(key: string): key is SourceKey {
  return key in SOURCES;
}

/**
 * Run a single source, wrapped with a poller_runs bookkeeping row.
 * Never throws — errors are captured and persisted.
 */
export async function runSource(key: SourceKey): Promise<RunResult & { error?: string }> {
  const startedAt = new Date();
  const db = tryGetDb();

  try {
    const fn = SOURCES[key];
    const result = await fn();
    const finishedAt = new Date();

    if (db) {
      await db.insert(pollerRuns).values({
        source: key,
        status: result.status ?? "ok",
        startedAt,
        finishedAt,
        etag: result.etag,
        lastModified: result.lastModified,
        lastSeenHash: result.lastSeenHash,
      });
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    if (db) {
      try {
        await db.insert(pollerRuns).values({
          source: key,
          status: "error",
          startedAt,
          finishedAt,
          error: message.slice(0, 2000),
        });
      } catch {
        // swallow — DB may be down, and we already have the original error to report
      }
    }
    // eslint-disable-next-line no-console
    console.error(`[poller] ${key} failed:`, message);
    return { inserted: 0, updated: 0, skipped: 0, error: message };
  }
}
