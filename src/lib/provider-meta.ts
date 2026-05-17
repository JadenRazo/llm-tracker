// Provider display + data-binding metadata.
//
// Phase 2.3 makes the site provider-aware. `src/lib/providers.ts` owns the
// canonical key set / zod enum; this module owns the *UI* and *data-routing*
// facts that vary per provider: display copy, the flagship coding-tool name,
// the accent token (kept inside the existing earth/forest palette — no new
// hues, no gradients), and the source keys each provider's pages read.
//
// Kept fully data-driven so Phase 2.4 can finalize brand copy without
// touching page components. Source keys are persisted strings — see
// src/lib/sources/registry.ts; never rename an existing one here.

import type { Provider } from "@/lib/providers";
import { PROVIDERS } from "@/lib/providers";

export interface ProviderMeta {
  /** Display label ("Claude", "OpenAI", "Gemini"). */
  label: string;
  /** The provider's flagship coding tool — what "/claude-code" maps to. */
  toolName: string;
  /** One-line working tagline. Provisional copy; 2.4 finalizes brand voice. */
  tagline: string;
  /**
   * Accent CSS variable, mapped to an existing palette token. Each provider
   * gets a distinguishing hue *from the current palette only* — no off-palette
   * colors, no gradients. Claude keeps its established leaf-green identity.
   */
  accentVar: string;
  /** Source keys whose events make up the release ladder, npm/CHANGELOG/GH. */
  releaseSources: readonly string[];
  /** Source key for the status snapshot + incident history. */
  statusSource: string;
  /** Source key for the recent-news strip on the provider home. */
  newsSource: string;
  /**
   * Source key whose latest event title carries the current CLI version
   * (drives the hero version pill + content-staleness checks).
   */
  cliVersionSource: string;
  /** External CTA links shown on the releases page. */
  releaseLinks: ReadonlyArray<{ label: string; href: string }>;
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  claude: {
    label: "Claude",
    toolName: "Claude Code",
    tagline:
      "Claude Code, MCP, and the Anthropic API — version-pinned and re-verified as releases ship.",
    accentVar: "var(--color-leaf)",
    releaseSources: [
      "npm_claude_code",
      "claude_code_changelog",
      "github_releases_claude_code",
    ],
    statusSource: "anthropic_status",
    newsSource: "anthropic_news",
    cliVersionSource: "npm_claude_code",
    releaseLinks: [
      {
        label: "npm",
        href: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
      },
      {
        label: "GitHub",
        href: "https://github.com/anthropics/claude-code/releases",
      },
    ],
  },
  openai: {
    label: "OpenAI",
    toolName: "Codex",
    tagline:
      "Codex CLI releases and OpenAI platform updates — deduped into one timeline.",
    accentVar: "var(--color-sage)",
    releaseSources: ["openai_codex_npm", "openai_codex_releases"],
    statusSource: "openai_status",
    newsSource: "openai_news",
    cliVersionSource: "openai_codex_npm",
    releaseLinks: [
      { label: "npm", href: "https://www.npmjs.com/package/@openai/codex" },
      {
        label: "GitHub",
        href: "https://github.com/openai/codex/releases",
      },
    ],
  },
  gemini: {
    label: "Gemini",
    toolName: "Gemini CLI",
    tagline:
      "Gemini CLI releases, changelog, and model catalog — kept current automatically.",
    accentVar: "var(--color-gold)",
    releaseSources: [
      "gemini_cli_npm",
      "gemini_cli_releases",
      "gemini_cli_changelog",
    ],
    statusSource: "gemini_status",
    newsSource: "gemini_news",
    cliVersionSource: "gemini_cli_npm",
    releaseLinks: [
      {
        label: "npm",
        href: "https://www.npmjs.com/package/@google/gemini-cli",
      },
      {
        label: "GitHub",
        href: "https://github.com/google-gemini/gemini-cli/releases",
      },
    ],
  },
};

export function getProviderMeta(provider: Provider): ProviderMeta {
  return PROVIDER_META[provider];
}

/** Display order for switchers / the cross-provider home (Claude first). */
export const PROVIDER_ORDER: readonly Provider[] = PROVIDERS;
