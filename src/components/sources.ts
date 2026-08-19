// Single source of truth for poller -> visual metadata mapping.
// Consumers: SourceIcon, Badge (source variant), Card (left accent),
// EventCard, ModelTable, and any page that needs source-coded styling.
//
// The key set is imported from the POLLER REGISTRY (`@/lib/sources/registry`),
// not redeclared here. It used to be a hand-maintained union that had drifted
// out of sync: it named `github_claude_code` while the poller persists
// `github_releases_claude_code`, and it predated every OpenAI and Gemini
// source. The result was that 19 of 25 sources — every GitHub release, every
// OpenAI source, every Gemini source, mcp_servers and the CLI references — fell
// through to the neutral default and rendered a grey chip literally labelled
// "event" ("Gemini event status" on the home feed). Typing SOURCES as
// Record<SourceKey, SourceMeta> makes a missing entry a compile error, so a new
// poller cannot ship without display metadata again.
//
// Icons are imported lazily via the lucide-react map — tree-shakes fine
// because the specific icon components are referenced directly.

// Note: lucide-react 1.x removed brand marks (Github, Twitter, etc). The
// plan spec asked for the `Github` icon on source chips, but since it is
// no longer exported, `GitBranch` is the closest in-package replacement
// and keeps the icon language consistent with the rest of the UI.
import {
  Activity,
  BookOpen,
  Boxes,
  FileText,
  GitBranch,
  Newspaper,
  Package,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { SourceKey } from "@/lib/sources/registry";

export type { SourceKey };

export interface SourceMeta {
  /** Short, uppercase-friendly label for badges ("npm", "status"). */
  label: string;
  /** Longer human-friendly label for tooltips / page copy. */
  longLabel: string;
  /** Lucide icon component. */
  icon: LucideIcon;
  /** CSS variable name that resolves to the source tint color. */
  cssVar: string;
  /** Utility class that sets `--tint` — apply to the element that renders the accent. */
  tintClass: string;
}

export const SOURCES: Record<SourceKey, SourceMeta> = {
  npm_claude_code: {
    label: "npm",
    longLabel: "npm @anthropic-ai/claude-code",
    icon: Package,
    cssVar: "--color-src-npm",
    tintClass: "src-npm",
  },
  anthropic_status: {
    label: "status",
    longLabel: "Anthropic status",
    icon: Activity,
    cssVar: "--color-src-status",
    tintClass: "src-status",
  },
  anthropic_models: {
    label: "models",
    longLabel: "Anthropic models",
    icon: Boxes,
    cssVar: "--color-src-models",
    tintClass: "src-models",
  },
  anthropic_news: {
    label: "news",
    longLabel: "Anthropic news",
    icon: Newspaper,
    cssVar: "--color-src-news",
    tintClass: "src-news",
  },
  claude_code_changelog: {
    label: "changelog",
    longLabel: "Claude Code changelog",
    icon: FileText,
    cssVar: "--color-src-changelog",
    tintClass: "src-changelog",
  },
  claude_code_reference: {
    label: "reference",
    longLabel: "Claude Code CLI reference",
    icon: Terminal,
    cssVar: "--color-src-docs",
    tintClass: "src-docs",
  },
  docs_release_notes: {
    label: "docs",
    longLabel: "Anthropic docs release notes",
    icon: BookOpen,
    cssVar: "--color-src-docs",
    tintClass: "src-docs",
  },
  github_releases_claude_code: {
    label: "gh / cc",
    longLabel: "GitHub · claude-code",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
  github_releases_sdk_python: {
    label: "gh / py",
    longLabel: "GitHub · anthropic-sdk-python",
    icon: GitBranch,
    cssVar: "--color-src-gh-py",
    tintClass: "src-gh-py",
  },
  github_releases_sdk_typescript: {
    label: "gh / ts",
    longLabel: "GitHub · anthropic-sdk-typescript",
    icon: GitBranch,
    cssVar: "--color-src-gh-ts",
    tintClass: "src-gh-ts",
  },
  github_releases_sdk_go: {
    label: "gh / go",
    longLabel: "GitHub · anthropic-sdk-go",
    icon: GitBranch,
    cssVar: "--color-src-gh-go",
    tintClass: "src-gh-go",
  },
  github_releases_agent_sdk_python: {
    label: "gh / agent-py",
    longLabel: "GitHub · claude-agent-sdk-python",
    icon: GitBranch,
    cssVar: "--color-src-gh-agent",
    tintClass: "src-gh-agent",
  },
  mcp_servers: {
    label: "mcp",
    longLabel: "MCP servers catalog",
    icon: Boxes,
    cssVar: "--color-src-models",
    tintClass: "src-models",
  },
  openai_codex_npm: {
    label: "npm",
    longLabel: "npm @openai/codex",
    icon: Package,
    cssVar: "--color-src-npm",
    tintClass: "src-npm",
  },
  openai_codex_releases: {
    label: "gh / codex",
    longLabel: "GitHub · openai/codex",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
  openai_codex_reference: {
    label: "reference",
    longLabel: "Codex CLI reference",
    icon: Terminal,
    cssVar: "--color-src-docs",
    tintClass: "src-docs",
  },
  openai_news: {
    label: "news",
    longLabel: "OpenAI news",
    icon: Newspaper,
    cssVar: "--color-src-news",
    tintClass: "src-news",
  },
  openai_status: {
    label: "status",
    longLabel: "OpenAI status",
    icon: Activity,
    cssVar: "--color-src-status",
    tintClass: "src-status",
  },
  gemini_cli_npm: {
    label: "npm",
    longLabel: "npm @google/gemini-cli",
    icon: Package,
    cssVar: "--color-src-npm",
    tintClass: "src-npm",
  },
  gemini_cli_releases: {
    label: "gh / gemini",
    longLabel: "GitHub · google-gemini/gemini-cli",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
  gemini_cli_changelog: {
    label: "changelog",
    longLabel: "Gemini CLI changelog",
    icon: FileText,
    cssVar: "--color-src-changelog",
    tintClass: "src-changelog",
  },
  gemini_cli_reference: {
    label: "reference",
    longLabel: "Gemini CLI reference",
    icon: Terminal,
    cssVar: "--color-src-docs",
    tintClass: "src-docs",
  },
  gemini_models: {
    label: "models",
    longLabel: "Gemini models",
    icon: Boxes,
    cssVar: "--color-src-models",
    tintClass: "src-models",
  },
  gemini_news: {
    label: "news",
    longLabel: "Gemini news",
    icon: Newspaper,
    cssVar: "--color-src-news",
    tintClass: "src-news",
  },
  gemini_status: {
    label: "status",
    longLabel: "Google Cloud AI status",
    icon: Activity,
    cssVar: "--color-src-status",
    tintClass: "src-status",
  },
};

/**
 * Rows written before the multi-provider split, plus any future key that has
 * not been given metadata yet, resolve here rather than crashing a render.
 */
const DEFAULT_META: SourceMeta = {
  label: "event",
  longLabel: "Event",
  icon: Package,
  cssVar: "--color-border",
  tintClass: "src-default",
};

/** Historic umbrella key from before per-repo GitHub sources existed. */
const LEGACY_ALIASES: Record<string, SourceMeta> = {
  github_releases: {
    label: "github",
    longLabel: "GitHub release",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
};

/**
 * Returns the metadata for a source key, falling back to a safe default
 * (neutral label, Package icon, border-colored tint) for unknown keys.
 */
export function getSource(key: string | null | undefined): SourceMeta {
  if (!key) return DEFAULT_META;
  return (
    (SOURCES as Record<string, SourceMeta>)[key] ?? LEGACY_ALIASES[key] ?? DEFAULT_META
  );
}
