// Single source of truth for poller -> visual metadata mapping.
// Consumers: SourceIcon, Badge (source variant), Card (left accent),
// EventCard, ModelTable, and any page that needs source-coded styling.
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
  FileText,
  GitBranch,
  Newspaper,
  Package,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type SourceKey =
  | "npm_claude_code"
  | "anthropic_status"
  | "anthropic_models"
  | "anthropic_news"
  | "claude_code_changelog"
  | "docs_release_notes"
  // Individual GitHub release sources (SDKs / agent)
  | "github_claude_code"
  | "github_anthropic_sdk_python"
  | "github_anthropic_sdk_typescript"
  | "github_anthropic_sdk_go"
  | "github_claude_agent_sdk_python"
  | "github_claude_agent_sdk_typescript"
  // Legacy umbrella key — still referenced by existing EventCard fallback.
  | "github_releases";

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
    icon: Sparkles,
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
  docs_release_notes: {
    label: "docs",
    longLabel: "Anthropic docs",
    icon: BookOpen,
    cssVar: "--color-src-docs",
    tintClass: "src-docs",
  },
  github_claude_code: {
    label: "gh / cc",
    longLabel: "GitHub · claude-code",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
  github_anthropic_sdk_python: {
    label: "gh / py",
    longLabel: "GitHub · anthropic-sdk-python",
    icon: GitBranch,
    cssVar: "--color-src-gh-py",
    tintClass: "src-gh-py",
  },
  github_anthropic_sdk_typescript: {
    label: "gh / ts",
    longLabel: "GitHub · anthropic-sdk-typescript",
    icon: GitBranch,
    cssVar: "--color-src-gh-ts",
    tintClass: "src-gh-ts",
  },
  github_anthropic_sdk_go: {
    label: "gh / go",
    longLabel: "GitHub · anthropic-sdk-go",
    icon: GitBranch,
    cssVar: "--color-src-gh-go",
    tintClass: "src-gh-go",
  },
  github_claude_agent_sdk_python: {
    label: "gh / agent-py",
    longLabel: "GitHub · claude-agent-sdk-python",
    icon: GitBranch,
    cssVar: "--color-src-gh-agent",
    tintClass: "src-gh-agent",
  },
  github_claude_agent_sdk_typescript: {
    label: "gh / agent-ts",
    longLabel: "GitHub · claude-agent-sdk-typescript",
    icon: GitBranch,
    cssVar: "--color-src-gh-agent",
    tintClass: "src-gh-agent",
  },
  // Legacy umbrella: some older rows (and current EventCard fallback) use
  // a single "github_releases" key without per-repo specificity. Keep it
  // functional so no existing render path breaks.
  github_releases: {
    label: "github",
    longLabel: "GitHub release",
    icon: GitBranch,
    cssVar: "--color-src-gh-cc",
    tintClass: "src-gh-cc",
  },
};

const DEFAULT_META: SourceMeta = {
  label: "event",
  longLabel: "Event",
  icon: Package,
  cssVar: "--color-border",
  tintClass: "src-default",
};

/**
 * Returns the metadata for a source key, falling back to a safe default
 * (neutral label, Package icon, border-colored tint) for unknown keys.
 */
export function getSource(key: string | null | undefined): SourceMeta {
  if (!key) return DEFAULT_META;
  return (SOURCES as Record<string, SourceMeta>)[key] ?? DEFAULT_META;
}
