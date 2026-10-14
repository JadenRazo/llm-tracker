import { FRONTIER_MAX_AGE_MS, type FrontierRevision, type FrontierState } from "./schema";
import { modelPrice, type FrontierModel } from "@/lib/frontier-models";

export function verificationLabel(iso?: string): string {
  return iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC" : "Not verified";
}
const tokens = (n: number) => n.toLocaleString("en-US") + " tokens";
export function presentFrontier(revision: FrontierRevision, state: FrontierState | undefined, now = new Date()): FrontierModel {
  const f = revision.facts;
  const archived = !!state?.revisionId && state.revisionId !== revision.id;
  const stale = now.getTime() - Date.parse(revision.verifiedAt) >= FRONTIER_MAX_AGE_MS;
  const failed = !!state?.error || !!state?.paused;
  const media = f.inputs.includes("audio") && f.inputs.includes("video");
  const focus = media ? "Audio, video & long-form work" : f.provider === "claude" ? "Long-running agents" : f.provider === "openai" ? "Reasoning & coding" : "Reasoning & long-form work";
  const conditions = [f.pricing.note];
  if (f.pricing.longContext) {
    const c = f.pricing.longContext;
    conditions.unshift(`Above ${c.above.toLocaleString("en-US")} input tokens, the full request costs ${c.inputMultiplier}× input and ${c.outputMultiplier}× output.`);
  }
  for (const c of f.pricing.changes) conditions.push(`From ${c.effectiveAt}: $${c.input} input / $${c.output} output per million tokens (UTC).`);
  const budget = f.context.kind === "shared" ? " · shared input + output" : f.context.kind === "total" ? " · total context" : f.context.kind === "input" ? " · input limit" : "";
  const why = media ? "The API accepts audio and video directly, alongside text and images. This can avoid separate transcription and frame-extraction steps."
    : f.selectionRule === "claude-demanding-work" ? `Anthropic positions this model for demanding reasoning and long-horizon agentic work.${f.reasoning.levels?.length ? " Adjustable effort lets you test the tradeoff between depth, time and token use." : " Test it on representative multistep tasks."}`
    : f.reasoning.levels?.length ? `Documented reasoning controls (${f.reasoning.levels.join(", ")}) let you tune effort. Check results and cost on your own tasks.`
      : "Compare the documented input formats and token limits with your material, then test the model on representative tasks.";
  const tradeoffs = [f.context.kind === "shared" ? "Input and output consume the same token budget." : "A larger context budget does not establish better recall or answer quality."];
  if (f.output.extended) tradeoffs.push("Long decode is a separate mode; the default output limit is lower.");
  if (f.pricing.longContext) tradeoffs.push("Long prompts increase the rate for the whole request.");
  if (!media) tradeoffs.push("Audio/video workflows need conversion unless documented separately by the provider.");
  return {
    id: f.id, provider: f.provider, name: f.name, lab: { claude: "Anthropic", openai: "OpenAI", gemini: "Google DeepMind" }[f.provider],
    focus, summary: media ? "Work directly with multiple media types and compare the limits for long responses." : f.provider === "claude" ? "Anthropic’s demanding-work pick for reasoning and long-running agents." : f.provider === "openai" ? "OpenAI’s recommended flagship for complex reasoning and coding." : "Google’s stable flagship for reasoning; check its documented input formats and token limits.",
    why, tradeoff: tradeoffs.join(" "), context: tokens(f.context.tokens) + budget + (f.context.maxInput ? `; up to ${tokens(f.context.maxInput)} input` : ""),
    output: tokens(f.output.tokens) + (f.output.extended ? ` default; up to ${tokens(f.output.extended)} with long decode` : ""),
    inputs: f.inputs.map((m) => ({ text: "Text", image: "images", audio: "audio", video: "video", pdf: "PDF" })[m]).join(", "),
    reasoning: [f.reasoning.levels?.join(", ") ?? "Effort levels not verified", f.reasoning.default ? `default ${f.reasoning.default}` : null, f.reasoning.mode].filter(Boolean).join("; "),
    access: f.access, price: { input: f.pricing.input, output: f.pricing.output, note: conditions.join(" "), cardNote: f.pricing.longContext ? "Long-context rates apply; open the profile for conditions." : f.pricing.changes.length ? "A dated price change is published; see the profile." : "Caching, tools and service tiers can change the total." },
    sources: f.sources, facts: f, verifiedAt: revision.verifiedAt, revisionId: revision.id,
    freshness: archived ? "archived" : failed ? "failed" : stale ? "stale" : "current",
    freshnessNote: archived ? "Earlier frontier pick. Its specifications are retained from the verification date below."
      : failed ? "The latest refresh could not be accepted. Showing the last verified profile."
        : stale ? "Verification is overdue. A newer model or price may be available." : "Official sources checked automatically every two hours.",
  };
}

export function taskGuidance(models: readonly FrontierModel[], asOf: string) {
  const ids = models.map((m) => m.id);
  const fresh = models.filter((m) => m.freshness === "current" && m.facts);
  const media = fresh.filter((m) => m.facts!.inputs.includes("audio") && m.facts!.inputs.includes("video"));
  const cheapest = fresh.length === models.length && fresh.length > 1 ? fresh.find((m) => fresh.every((other) => {
    const a = modelPrice(m, asOf), b = modelPrice(other, asOf); return a.input <= b.input && a.output <= b.output;
  }) && fresh.some((other) => { const a = modelPrice(m, asOf), b = modelPrice(other, asOf); return a.input < b.input || a.output < b.output; })) : undefined;
  return [
    { label: "Code & agents", title: "Test the same task with the same tools.", body: "Use your repository, expected changes and test suite to compare results. Documented reasoning controls help you configure the trial; they do not establish a coding-quality winner.", ids },
    { label: "Audio & video", title: media.length ? `Direct media input: ${media.map((m) => m.name).join(", ")}.` : "Check the documented input formats.", body: media.length ? "These currently verified APIs accept both audio and video. Direct input can reduce preprocessing; answer quality still needs a representative test." : "No current verified profile establishes a direct audio-and-video recommendation. Check the source links before choosing a workflow.", ids },
    { label: "Research & documents", title: "Check evidence, recall and citations.", body: "Compare supported document formats and input budgets. Shared context includes output, and a bigger number alone does not demonstrate better recall or more accurate citations.", ids },
    { label: "Cost & speed", title: cheapest ? `${cheapest.name} has the lowest base rates among these picks.` : "Compare the total cost of your task.", body: "Rates shown are standard API prices for short text requests. Long context, thinking, tools, retries and service tiers can change the bill. No comparable latency measurements are available here.", ids },
  ];
}
