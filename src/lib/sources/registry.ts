// Provider-keyed source registry.
//
// Phase 2.1 replaces the hardcoded `SourceKey` union + static `SOURCES` record
// with this registry: every source module exports a `descriptor` declaring its
// persisted key, owning provider, scheduling tier, and run function. The runner
// derives its key union/dispatch from here; the cron scheduler derives its
// tiers by filtering on `tier`. No behavior change for Claude — same keys, same
// cadence, same data written.
//
// IMPORTANT: `descriptor.key` is the value persisted in `poller_runs.source`
// and `events.source`. Never rename an existing key — it breaks dedupe and
// run bookkeeping. Add new providers/sources by appending descriptors.

import type { Provider } from "@/lib/providers";
import type { RunResult } from "@/lib/poller/runner";

/** Scheduling tier — drives the cron cadence (T1 10m / T2 30m / T3 2h). */
export type SourceTier = 1 | 2 | 3;

/**
 * Authoritative key contract. Every descriptor's `key` must be a member —
 * adding a source (incl. new providers in later phases) is a deliberate,
 * compile-enforced edit here, restoring the exhaustiveness the pre-2.1
 * hardcoded union gave. These strings are persisted in poller_runs.source /
 * events.source — never rename an existing one.
 */
export type SourceKey =
  | "npm_claude_code"
  | "anthropic_status"
  | "anthropic_models"
  | "github_releases_claude_code"
  | "github_releases_sdk_python"
  | "github_releases_sdk_typescript"
  | "github_releases_sdk_go"
  | "github_releases_agent_sdk_python"
  | "claude_code_changelog"
  | "claude_code_reference"
  | "docs_release_notes"
  | "anthropic_news"
  | "mcp_servers"
  // ---- Phase 2.2: OpenAI / Codex (provider "openai") ----
  | "openai_codex_npm"
  | "openai_codex_releases"
  | "openai_codex_reference"
  | "openai_news"
  | "openai_status"
  // ---- Phase 2.2: Gemini (provider "gemini") ----
  | "gemini_cli_npm"
  | "gemini_cli_releases"
  | "gemini_cli_changelog"
  | "gemini_cli_reference"
  | "gemini_models"
  | "gemini_news"
  | "gemini_status";

export interface SourceDescriptor {
  /** Persisted source key — stored verbatim in poller_runs.source / events.source. */
  key: SourceKey;
  /** Owning LLM provider — stamped onto rows this source writes. */
  provider: Provider;
  /** Scheduling tier. */
  tier: SourceTier;
  /** The scraping/poll function. Must not throw for non-errors (see RunResult). */
  run: () => Promise<RunResult>;
}

import { anthropicModelsSource } from "@/lib/sources/claude/anthropic_models";
import { anthropicNewsSource } from "@/lib/sources/claude/anthropic_news";
import { anthropicStatusSource } from "@/lib/sources/claude/anthropic_status";
import { claudeCodeChangelogSource } from "@/lib/sources/claude/claude_code_changelog";
import { claudeCodeReferenceSource } from "@/lib/sources/claude/claude_code_reference";
import { docsReleaseNotesSource } from "@/lib/sources/claude/docs_release_notes";
import {
  githubReleasesAgentSdkPythonSource,
  githubReleasesClaudeCodeSource,
  githubReleasesSdkGoSource,
  githubReleasesSdkPythonSource,
  githubReleasesSdkTypescriptSource,
} from "@/lib/sources/claude/github_releases";
import { mcpServersSource } from "@/lib/sources/claude/mcp_servers";
import { npmClaudeCodeSource } from "@/lib/sources/claude/npm_claude_code";
import { geminiCliChangelogSource } from "@/lib/sources/gemini/gemini_cli_changelog";
import { geminiCliNpmSource } from "@/lib/sources/gemini/gemini_cli_npm";
import { geminiCliReferenceSource } from "@/lib/sources/gemini/gemini_cli_reference";
import { geminiCliReleasesSource } from "@/lib/sources/gemini/gemini_cli_releases";
import { geminiModelsSource } from "@/lib/sources/gemini/gemini_models";
import { geminiNewsSource } from "@/lib/sources/gemini/gemini_news";
import { geminiStatusSource } from "@/lib/sources/gemini/gemini_status";
import { openaiCodexNpmSource } from "@/lib/sources/openai/openai_codex_npm";
import { openaiCodexReferenceSource } from "@/lib/sources/openai/openai_codex_reference";
import { openaiCodexReleasesSource } from "@/lib/sources/openai/openai_codex_releases";
import { openaiNewsSource } from "@/lib/sources/openai/openai_news";
import { openaiStatusSource } from "@/lib/sources/openai/openai_status";

/**
 * The canonical source list. Order within a tier preserves the pre-refactor
 * tier-array ordering so boot kicks fan out identically.
 */
export const SOURCE_REGISTRY: readonly SourceDescriptor[] = [
  // ---- Tier 1 (every 10m): cheap, time-sensitive ----
  npmClaudeCodeSource,
  anthropicStatusSource,
  openaiCodexNpmSource,
  geminiCliNpmSource,
  // ---- Tier 2 (every 30m): medium-weight ----
  anthropicModelsSource,
  githubReleasesClaudeCodeSource,
  githubReleasesSdkPythonSource,
  githubReleasesSdkTypescriptSource,
  githubReleasesSdkGoSource,
  githubReleasesAgentSdkPythonSource,
  claudeCodeChangelogSource,
  claudeCodeReferenceSource,
  openaiCodexReleasesSource,
  openaiCodexReferenceSource,
  openaiNewsSource,
  openaiStatusSource,
  geminiCliReleasesSource,
  geminiCliChangelogSource,
  geminiCliReferenceSource,
  geminiNewsSource,
  // ---- Tier 3 (every 2h): HTML scrapes ----
  docsReleaseNotesSource,
  anthropicNewsSource,
  mcpServersSource,
  geminiModelsSource,
  geminiStatusSource,
] as const;

const REGISTRY_BY_KEY: ReadonlyMap<string, SourceDescriptor> = new Map(
  SOURCE_REGISTRY.map((d) => [d.key, d]),
);

export function getSourceDescriptor(key: string): SourceDescriptor | undefined {
  return REGISTRY_BY_KEY.get(key);
}

export function sourcesForTier(tier: SourceTier): readonly SourceDescriptor[] {
  return SOURCE_REGISTRY.filter((d) => d.tier === tier);
}
