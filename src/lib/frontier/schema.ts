import { z } from "zod";

export const FRONTIER_SCHEMA_VERSION = 1;
export const FRONTIER_PARSER_VERSION = "2026-10-14.1";
export const FRONTIER_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const frontierProviders = ["claude", "openai", "gemini"] as const;
const count = z.number().int().positive().max(100_000_000);
const rate = z.number().nonnegative().max(100_000);
const modality = z.enum(["text", "image", "audio", "video", "pdf"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);

export const frontierFactsSchema = z.object({
  schemaVersion: z.literal(FRONTIER_SCHEMA_VERSION),
  parserVersion: z.string().min(1).max(80),
  provider: z.enum(frontierProviders),
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,100}$/),
  name: z.string().min(1).max(120),
  selectionRule: z.enum(["claude-demanding-work", "openai-intro-flagship", "gemini-stable-reasoning"]),
  inputs: z.array(modality).min(1),
  outputs: z.array(modality).min(1),
  context: z.object({ tokens: count, kind: z.enum(["input", "total", "shared", "context"]), maxInput: count.optional() }).strict(),
  output: z.object({ tokens: count, extended: count.optional() }).strict(),
  reasoning: z.object({ levels: z.array(z.string().min(1).max(30)).nullable(), mode: z.string().max(80).nullable(), default: z.string().max(30).nullable() }).strict(),
  pricing: z.object({
    input: rate, output: rate,
    changes: z.array(z.object({ effectiveAt: date, input: rate, output: rate }).strict()).max(4),
    longContext: z.object({ above: count, inputMultiplier: z.number().positive().max(100), outputMultiplier: z.number().positive().max(100) }).strict().optional(),
    note: z.string().min(1).max(1000),
  }).strict(),
  access: z.string().min(1).max(300),
  sources: z.array(z.object({ url: z.string().url(), label: z.string().min(1).max(100), hash: z.string().regex(/^[a-f0-9]{64}$/), fields: z.array(z.string()).min(1) }).strict()).min(2).max(4),
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const prefix = { claude: "claude-", openai: "gpt-", gemini: "gemini-" }[value.provider];
  if (!value.id.startsWith(prefix)) fail("Model identity does not match provider");
  if (!value.outputs.includes("text")) fail("Frontier comparison requires text output");
  if (value.output.tokens > value.context.tokens || (value.output.extended ?? 0) > value.context.tokens) fail("Output exceeds context budget");
  if ((value.context.maxInput ?? 0) > value.context.tokens) fail("Input exceeds context budget");
  if (new Set(value.inputs).size !== value.inputs.length || new Set(value.outputs).size !== value.outputs.length) fail("Duplicate modality");
  const dates = value.pricing.changes.map((c) => c.effectiveAt);
  if (dates.some((d, i) => i > 0 && d <= dates[i - 1])) fail("Price changes must be strictly chronological");
});

export type FrontierFacts = z.infer<typeof frontierFactsSchema>;
export type FrontierProvider = FrontierFacts["provider"];
export interface SourceDocument { url: string; body: string; hash: string; etag?: string; lastModified?: string }
export interface FrontierRevision { id: string; facts: FrontierFacts; verifiedAt: string }
export interface FrontierState { provider: FrontierProvider; revisionId: string | null; attemptedAt: string | null; error: string | null; paused: boolean }

export const LINEUPS: Record<FrontierProvider, string> = {
  claude: "https://platform.claude.com/docs/en/models/overview",
  openai: "https://developers.openai.com/api/docs/models.md",
  gemini: "https://ai.google.dev/gemini-api/docs/models?hl=en",
};
export const AUXILIARY = {
  claudeEffort: "https://platform.claude.com/docs/en/build-with-claude/effort",
  claudePdf: "https://platform.claude.com/docs/en/build-with-claude/pdf-support",
  openaiPdf: "https://developers.openai.com/api/docs/guides/file-inputs.md",
  geminiPricing: "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
};

/** A discovered link never grants permission to fetch an arbitrary URL. */
export function allowedDocument(provider: FrontierProvider, raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    if (provider === "gemini" ? url.search !== "?hl=en" : Boolean(url.search)) return false;
    if (provider === "openai") return url.hostname === "developers.openai.com" && /^\/api\/docs\/(models(?:\/[a-z0-9.-]+)?|guides\/file-inputs)\.md$/.test(url.pathname);
    if (provider === "claude") return url.hostname === "platform.claude.com" && /^\/docs\/en\/(models\/(?:overview|[a-z0-9-]+\/overview)|build-with-claude\/(?:effort|pdf-support))$/.test(url.pathname);
    return url.hostname === "ai.google.dev" && /^\/gemini-api\/docs\/(?:models(?:\/[a-z0-9.-]+)?|pricing)$/.test(url.pathname);
  } catch { return false; }
}
