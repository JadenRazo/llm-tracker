import type { Provider } from "@/lib/providers";
import type { FrontierFacts } from "@/lib/frontier/schema";

// Editorial profiles: official sources checked by a person/agent, not inferred
// from ingestion timestamps or model names. See content/frontier-models.md.
export const FRONTIER_REVIEWED_AT = "2026-10-14";
export const FRONTIER_REVIEW_DAYS = 30;
export const FRONTIER_REVIEW_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${FRONTIER_REVIEWED_AT}T00:00:00Z`));

export interface FrontierModel {
  id: string;
  provider: Provider;
  name: string;
  lab: string;
  focus: string;
  summary: string;
  why: string;
  tradeoff: string;
  context: string;
  output: string;
  inputs: string;
  reasoning: string;
  access: string;
  price: { input: number; output: number; cardNote: string; note: string; until?: string; nextInput?: number; nextOutput?: number };
  sources: { label: string; url: string }[];
  facts?: FrontierFacts;
  verifiedAt?: string;
  revisionId?: string;
  freshness?: "current" | "stale" | "failed" | "fallback" | "archived";
  freshnessNote?: string;
}

export const FRONTIER_MODELS: readonly FrontierModel[] = [
  {
    id: "claude-fable-5-1", provider: "claude", name: "Claude Fable 5.1", lab: "Anthropic",
    focus: "Long-running agents",
    summary: "For difficult reasoning, multistep research, and work that spans many tool calls.",
    why: "Anthropic positions Fable for demanding tasks where Opus at higher effort still falls short. Adaptive thinking stays on throughout the work.",
    tradeoff: "Anthropic lists slower latency than Opus. Start with Opus 5.5 for most workloads; justify Fable’s higher cost with your own results.",
    context: "1M tokens", output: "128K tokens", inputs: "Text, images, PDF", reasoning: "Low, medium, high, xhigh, max; default high. Adaptive thinking stays on.",
    access: "Claude API and supported cloud platforms",
    price: { input: 10, output: 50, cardNote: "Caching and batch rates differ.", note: "Standard token rates. Caching and batch rates differ." },
    sources: [
      { label: "Model specifications & pricing", url: "https://platform.claude.com/docs/en/models/fable-5-1/overview" },
      { label: "Claude model lineup", url: "https://platform.claude.com/docs/en/models/overview" },
      { label: "PDF support", url: "https://platform.claude.com/docs/en/build-with-claude/pdf-support" },
      { label: "Reasoning effort", url: "https://platform.claude.com/docs/en/build-with-claude/effort" },
    ],
  },
  {
    id: "gpt-6-astra", provider: "openai", name: "GPT-6 Astra", lab: "OpenAI",
    focus: "Reasoning & tool workflows",
    summary: "A flagship for complex code, research, and document work with OpenAI’s tools.",
    why: "Five reasoning effort levels let you tune depth. The Responses API supports web and file search, computer use, and code tools.",
    tradeoff: "No native audio or video input. Prompts above 272K input tokens cost more across the full request.",
    context: "1,050,000 tokens", output: "128K tokens", inputs: "Text, images, PDF", reasoning: "Low, medium, high, xhigh, max",
    access: "OpenAI API",
    price: { input: 10, output: 50, cardNote: "Above 272K input: $20 in / $75 out for the full request.", note: "Above 272K input tokens: $20 input / $75 output. Tools and service tiers may add costs." },
    sources: [
      { label: "Model specifications & pricing", url: "https://developers.openai.com/api/docs/models/gpt-6-astra" },
      { label: "OpenAI model lineup", url: "https://developers.openai.com/api/docs/models" },
      { label: "File and PDF inputs", url: "https://developers.openai.com/api/docs/guides/file-inputs" },
    ],
  },
  {
    id: "gemini-4-argon", provider: "gemini", name: "Gemini 4 Argon", lab: "Google DeepMind",
    focus: "Multimodal & long output",
    summary: "Reason across text, images, audio, and video, with an option for very long responses.",
    why: "Native audio and video input expand the material you can analyze. Long decode supports output up to the shared context limit.",
    tradeoff: "Input and output share one token budget. Long decode is a separate mode; the default synchronous output limit is 65,536 tokens.",
    context: "1,048,576 tokens · shared input + output", output: "65,536 default; up to 1,048,576 with long decode",
    inputs: "Text, images, audio, video, PDF", reasoning: "Low, medium, high",
    access: "Paid Gemini API; unavailable on the free tier or Google AI Pro",
    price: { input: 2, output: 10, until: "2026-12-01", nextInput: 4, nextOutput: 20, cardNote: "$2 / $10 through Nov 30, 2026; then $4 / $20 from Dec 1.", note: "$2 / $10 through Nov 30, 2026; $4 / $20 from Dec 1. Output includes thinking tokens. Grounding may add costs." },
    sources: [
      { label: "Model specifications", url: "https://ai.google.dev/gemini-api/docs/models/gemini-4-argon" },
      { label: "Gemini API pricing", url: "https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon" },
      { label: "Gemini model lineup", url: "https://ai.google.dev/gemini-api/docs/models" },
    ],
  },
];

export function frontierModel(id: string): FrontierModel | undefined {
  return FRONTIER_MODELS.find((model) => model.id === id);
}

/** Missing means defaults; empty/invalid means no selection, never invented IDs. */
export function comparisonSelection(raw: string | null | undefined, available: readonly FrontierModel[] = FRONTIER_MODELS): FrontierModel[] {
  if (raw == null) return available.filter((m) => m.freshness !== "archived").slice(0,3);
  const ids = new Set(raw.split(","));
  return available.filter((model) => ids.has(model.id)).slice(0,3);
}

export function comparisonHref(ids: readonly string[], available: readonly FrontierModel[] = FRONTIER_MODELS): string {
  const selected = comparisonSelection(ids.join(","), available);
  return `/compare?models=${selected.map((model) => model.id).join(",")}`;
}

export function profileNeedsReview(now: Date): boolean {
  return now.getTime() - Date.parse(`${FRONTIER_REVIEWED_AT}T00:00:00Z`) >= FRONTIER_REVIEW_DAYS * 86_400_000;
}

export function modelPrice(model: FrontierModel, asOf: string) {
  if (model.facts) {
    const pricing = model.facts.pricing;
    const change = pricing.changes.filter((c) => c.effectiveAt <= asOf).at(-1);
    return { input: change?.input ?? pricing.input, output: change?.output ?? pricing.output };
  }
  const price = model.price;
  if (price.until && asOf >= price.until && price.nextInput !== undefined && price.nextOutput !== undefined) {
    return { input: price.nextInput, output: price.nextOutput };
  }
  return { input: price.input, output: price.output };
}

export type ComparisonRow = { label: string; values: string[] };
export function comparisonRows(models: readonly FrontierModel[], asOf: string): ComparisonRow[] {
  const fields: [string, (model: FrontierModel) => string][] = [
    ["Consider it for", (m) => m.focus],
    ["Why it may fit", (m) => m.why],
    ["Tradeoff", (m) => m.tradeoff],
    ["Inputs", (m) => m.inputs],
    ["Context budget", (m) => m.context],
    ["Maximum output", (m) => m.output],
    ["Reasoning controls", (m) => m.reasoning],
    ["Input / 1M tokens", (m) => `$${modelPrice(m, asOf).input}`],
    ["Output / 1M tokens", (m) => `$${modelPrice(m, asOf).output}`],
    ["Pricing conditions", (m) => m.price.note],
    ["API access", (m) => m.access],
    ["Native output", (m) => m.facts ? m.facts.outputs.join(", ") : "Text"],
  ];
  return fields.map(([label, getValue]) => ({ label, values: models.map(getValue) }));
}

export function differingRows(rows: readonly ComparisonRow[]): ComparisonRow[] {
  return rows.filter((row) => new Set(row.values).size > 1);
}
