// Scores a lab published about its own models. They are shown beside
// independent results, always labelled, and never used to mark a leader: the
// lab chose the settings, ran the evaluation and chose what to publish.
//
// These cannot be polled reliably (launch pages change shape and some refuse
// automated clients), so each entry is added by hand after reading the source,
// with the page it came from and the date it was read. Add an entry only for a
// number you have seen on the cited page.

import type { BenchmarkKey } from "./registry";
import type { Effort } from "./feeds";

export interface ReportedScore {
  benchmark: BenchmarkKey;
  /** Tracked model ID. */
  modelId: string;
  score: number;
  /** The lab that published the number (not necessarily the model's maker). */
  reportedBy: string;
  effort: Effort | null;
  /** Conditions the source states, in its own terms. */
  settings: string;
  sourceUrl: string;
  sourceTitle: string;
  /** Date the source was read and the number checked (YYYY-MM-DD). */
  retrieved: string;
}

const GPT62_CARD = { reportedBy: "OpenAI", sourceUrl: "https://deploymentsafety.openai.com/gpt-6-2-astra-sol", sourceTitle: "GPT-6.2 System Card (published 2026-11-17)", retrieved: "2026-11-17" } as const;

export const REPORTED_SCORES: readonly ReportedScore[] = [
  // Table 2, "GPQA Diamond (no tools)", accuracy.
  ...([["gpt-6.2-astra", 97.0], ["gpt-6.2-sol", 96.0], ["gpt-6-astra", 96.0], ["gpt-6.1-terra", 93.56]] as const).map(([modelId, score]) => ({
    benchmark: "gpqa_diamond" as const, modelId, score, effort: null, settings: "No tools; reasoning effort not stated", ...GPT62_CARD,
  })),
  // Table 4, "SEC-Bench Pro", vulnerability reproduction (pass@1).
  ...([["gpt-6.2-astra", 86.75], ["gpt-6.2-sol", 88.34], ["gpt-6-astra", 85.4], ["gpt-6.1-terra", 83.3], ["gpt-6.1-sol", 78.8]] as const).map(([modelId, score]) => ({
    // The card states the effort for GPT-6.2 Astra only.
    benchmark: "sec_bench_pro" as const, modelId, score, effort: modelId === "gpt-6.2-astra" ? ("max" as const) : null,
    settings: modelId === "gpt-6.2-astra" ? "Maximum reasoning effort, per the card's text" : "Reasoning effort not stated for this model", ...GPT62_CARD,
  })),
  // Table 5, "MLE-Bench Revised", mean reference percentile.
  ...([["gpt-6.2-astra", 96.06], ["gpt-6.2-sol", 91.38], ["gpt-6-astra", 93.8], ["gpt-6.1-terra", 86.5], ["gpt-5.6-sol", 87.18]] as const).map(([modelId, score]) => ({
    benchmark: "mle_bench_revised" as const, modelId, score, effort: null, settings: "72 competitions, up to three submissions each; reasoning effort not stated", ...GPT62_CARD,
  })),
];
