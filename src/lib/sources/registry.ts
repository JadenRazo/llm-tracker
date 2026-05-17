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

export interface SourceDescriptor {
  /** Persisted source key — stored verbatim in poller_runs.source / events.source. */
  key: string;
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

/**
 * The canonical source list. Order within a tier preserves the pre-refactor
 * tier-array ordering so boot kicks fan out identically.
 */
export const SOURCE_REGISTRY: readonly SourceDescriptor[] = [
  // ---- Tier 1 (every 10m): cheap, time-sensitive ----
  npmClaudeCodeSource,
  anthropicStatusSource,
  // ---- Tier 2 (every 30m): medium-weight ----
  anthropicModelsSource,
  githubReleasesClaudeCodeSource,
  githubReleasesSdkPythonSource,
  githubReleasesSdkTypescriptSource,
  githubReleasesSdkGoSource,
  githubReleasesAgentSdkPythonSource,
  claudeCodeChangelogSource,
  claudeCodeReferenceSource,
  // ---- Tier 3 (every 2h): HTML scrapes ----
  docsReleaseNotesSource,
  anthropicNewsSource,
  mcpServersSource,
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
