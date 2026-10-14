import * as cheerio from "cheerio";
import { AUXILIARY, FRONTIER_PARSER_VERSION, FRONTIER_SCHEMA_VERSION, LINEUPS, allowedDocument, frontierFactsSchema, type FrontierFacts, type FrontierProvider, type SourceDocument } from "./schema";

type Candidate = { id: string; name: string; url: string; rule: FrontierFacts["selectionRule"] };
const clean = (raw: string) => raw.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function html(body: string) { const $ = cheerio.load(body); $("script,style,nav,aside[aria-label]").remove(); $("br").replaceWith(" "); return $; }
function count(raw: string): number {
  const match = clean(raw).match(/^([\d,]+(?:\.\d+)?)\s*([KM])?\s*(?:tokens)?$/i);
  need(match, `Unrecognized token limit: ${clean(raw).slice(0,100)}`);
  return Number(match[1].replaceAll(",", "")) * ({ k: 1e3, m: 1e6 }[match[2]?.toLowerCase() as "k" | "m"] ?? 1);
}
function modalities(raw: string): FrontierFacts["inputs"] {
  const parts = clean(raw).toLowerCase().replace(/\band\b/g, ",").split(/[,/]/).map((p) => p.trim().replace(/images$/, "image")).filter(Boolean);
  need(parts.length && parts.every((p) => ["text", "image", "audio", "video", "pdf"].includes(p)), "Unrecognized modality list");
  return [...new Set(parts)] as FrontierFacts["inputs"];
}
function exactlyOne(candidates: Candidate[], provider: string): Candidate {
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  need(unique.length === 1, `${provider}: expected one eligible frontier candidate, found ${unique.length}`);
  const candidate = unique[0];
  need(!/preview|experimental|deprecated|retired/i.test(candidate.id + " " + candidate.name), "Candidate is not a stable model");
  need(allowedDocument(provider as FrontierProvider, candidate.url), "Candidate detail URL is not allowed");
  return candidate;
}

export function selectCandidate(provider: FrontierProvider, body: string): Candidate {
  const candidates: Candidate[] = [];
  if (provider === "openai") {
    const intro = body.split(/^## Featured models\s*$/m)[0];
    need(intro !== body, "OpenAI featured-model boundary missing");
    for (const match of intro.matchAll(/\[([^\]]+)\]\(\/api\/docs\/models\/([a-z0-9.-]+)\),?\s+our flagship model for complex reasoning and coding/gi)) {
      candidates.push({ id: match[2], name: match[1], url: `https://developers.openai.com/api/docs/models/${match[2]}.md`, rule: "openai-intro-flagship" });
    }
  } else if (provider === "claude") {
    const $ = html(body);
    const table = $("table").filter((_, t) => $(t).find("thead").text().includes("Feature") && $(t).text().includes("Claude API ID")).first();
    const ids = table.find("tbody tr").filter((_, row) => clean($(row).find("th,td").first().text()).replace(/\d+$/, "") === "Claude API ID").find("td");
    table.find("thead th").slice(1).each((i, cell) => {
      if (!/For demanding reasoning and long-horizon agentic work/i.test(clean($(cell).text()))) return;
      const link = $(cell).find("a").first();
      const id = clean(ids.eq(i).text());
      need(id && link.attr("href"), "Claude candidate identity missing");
      candidates.push({ id, name: clean(link.text()), url: new URL(link.attr("href")!, LINEUPS.claude).href, rule: "claude-demanding-work" });
    });
  } else {
    const $ = html(body);
    $('a[href*="/gemini-api/docs/models/"]').each((_, el) => {
      const card = $(el);
      if (!/^Our flagship reasoning model\b/i.test(clean(card.find(".description-centered").text()))) return;
      if (!/^(?:New )?Stable$/i.test(clean(card.find(".status-subtext").text()))) return;
      const url = new URL(card.attr("href")!, LINEUPS.gemini);
      // The source serves locale redirects without an explicit language.
      // Preserve unexpected parameters so the URL allowlist can reject them.
      url.searchParams.set("hl", "en");
      candidates.push({ id: url.pathname.split("/").at(-1)!, name: clean(card.find("h3").text()), url: url.href, rule: "gemini-stable-reasoning" });
    });
  }
  return exactlyOne(candidates, provider);
}

export function requiredDocuments(provider: FrontierProvider, candidate: Candidate): string[] {
  return provider === "claude" ? [candidate.url, AUXILIARY.claudeEffort, AUXILIARY.claudePdf]
    : provider === "openai" ? [candidate.url, AUXILIARY.openaiPdf] : [candidate.url, AUXILIARY.geminiPricing];
}

function exactRate(raw: string): number {
  const match = clean(raw).match(/^\$([\d.]+)(?:\s*\/\s*MTok)?$/);
  need(match && Number.isFinite(Number(match[1])), "Unrecognized standard token rate");
  return Number(match[1]);
}

function rejectUnknownPriceConditions(text: string, provider: string) {
  const money = /\$|\b(?:prices?|pricing|rates?|costs?|surcharge|billed|charges?)\b/i;
  const conditional = /\b(?:above|over|exceed\w*|more than|long.context|introductory|until|through|starting|effective|double\w*|triple\w*|surcharge|additional|extra)\b|\d+(?:\.\d+)?\s*[×x]/i;
  need(!text.split(/(?<=[.!?])\s+/).some((sentence) => money.test(sentence) && conditional.test(sentence)), `${provider}: unrecognized pricing condition; review needed`);
}
function isoDate(raw: string): string {
  need(/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(raw), "Unrecognized price date");
  const date = new Date(`${raw} 00:00:00 UTC`);
  need(Number.isFinite(date.getTime()), "Invalid price date");
  return date.toISOString().slice(0,10);
}
export function scheduledRate(raw: string): { initial: number; change?: { date: string; value: number } } {
  const text = clean(raw);
  if (/^\$[\d.]+$/.test(text)) return { initial: exactRate(text) };
  const match = text.match(/^\$([\d.]+) through ([A-Za-z]+ \d{1,2}, \d{4})\.\s*\$([\d.]+) starting ([A-Za-z]+ \d{1,2}, \d{4})\.$/);
  need(match, "Unrecognized price conditions; review needed");
  const end = isoDate(match[2]), start = isoDate(match[4]);
  need(Date.parse(start) - Date.parse(end) === 86_400_000, "Price schedule contains a gap or overlap");
  return { initial: Number(match[1]), change: { date: start, value: Number(match[3]) } };
}

export function parseFrontier(provider: FrontierProvider, candidate: Candidate, documents: SourceDocument[]): FrontierFacts {
  const doc = (url: string) => { const found = documents.find((d) => d.url === url); need(found, `Missing document: ${url}`); return found.body; };
  const detail = doc(candidate.url);
  let facts: Omit<FrontierFacts, "schemaVersion" | "parserVersion" | "provider" | "id" | "name" | "selectionRule" | "sources">;
  if (provider === "openai") {
    // Include identity/specification and dedicated lifecycle sections, while
    // keeping feature/tool previews separate from the model's own lifecycle.
    const sections = detail.split(/^## /m);
    const lifecycleSections = sections.filter((s, i) => i > 0 && /^(?:Status|Availability|Access|Lifecycle|Deprecation)\s*\n/i.test(s));
    need(!lifecycleSections.some((s) => /\b(?:preview|deprecated|retired|restricted|limited|partner|invite|experimental)\b/i.test(s)), "OpenAI model eligibility/access restriction");
    const modelInfo = sections.filter((s, i) => i === 0 || /^(?:Model details|Status|Availability|Access|Lifecycle|Deprecation)\s*\n/i.test(s)).join("\n")
      .replace(/\*\*|__/g, "").replace(/^[\s>|*-]+/gm, "");
    need(!/^(?:Status|Availability|Access|Lifecycle)\s*[:|].*(?:preview|deprecated|retired|restricted|limited|partner|invite|experimental)/im.test(modelInfo), "OpenAI model eligibility/access restriction");
    const modelStatements = modelInfo.split(/\n|(?<=[.!?])\s+/).filter((line) => line.includes(candidate.name) || /\b(?:this model|model is|available only|access is)\b/i.test(line));
    need(!modelStatements.some((line) => /\b(?:deprecated|retired|partner.only|invite.only|restricted access|limited access|available only|experimental|preview model|model in preview|is (?:in )?preview)\b/i.test(line)), "OpenAI model is not broadly available and active");
    need(detail.match(/^Model ID: `([^`]+)`/m)?.[1] === candidate.id, "OpenAI detail identity mismatch");
    need(detail.match(/^# (.+)$/m)?.[1] === candidate.name, "OpenAI detail name mismatch");
    const section = detail.split(/^## Model details\s*$/m)[1]?.split(/^## /m)[0];
    need(section, "OpenAI model details missing");
    const input = modalities(section.match(/^- Input modalities: (.+)$/m)?.[1] ?? "");
    const output = modalities(section.match(/^- Output modalities: (.+)$/m)?.[1] ?? "");
    const context = count(section.match(/^- ([\d,]+) context window$/m)?.[1] ?? "");
    const maxOutput = count(section.match(/^- ([\d,]+) max output tokens$/m)?.[1] ?? "");
    const maxInput = section.match(/^- Maximum input tokens: ([\d,]+)$/m)?.[1];
    const pricing = detail.split(/^### Text tokens\s*$/m)[1]?.split(/^## /m)[0];
    need(pricing, "OpenAI text pricing missing");
    const rate = (name: string) => {
      const match = pricing.match(new RegExp(`^\\| ${name} \\| \\$([\\d.]+) \\| 1M tokens \\|$`, "m"));
      need(match, "OpenAI standard per-million price missing"); return Number(match[1]);
    };
    let longContext: FrontierFacts["pricing"]["longContext"];
    for (const line of pricing.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("|"))) {
      const long = line.match(/^- Prompts with more than ([\d,.]+[KM]?) input tokens are priced at ([\d.]+)x input and cache rates and ([\d.]+)x output for the full request\.$/);
      if (long) { need(!longContext, "Conflicting long-context prices"); longContext = { above: count(long[1]), inputMultiplier: Number(long[2]), outputMultiplier: Number(long[3]) }; }
      else need(/^- Cache writes are billed at [\d.]+x the uncached input token rate\.$/.test(line) || /^- Batch and Flex are priced at [\d.]+% of Standard rates\. Fast mode is priced at [\d.]+x the applicable rates\.$/.test(line), "Unrecognized OpenAI pricing qualifier");
    }
    const reasoning = detail.match(/`reasoning\.effort` supports ([^\n]+)\./)?.[1];
    const levels = reasoning ? [...reasoning.matchAll(/`([a-z]+)`/g)].map((m) => m[1]) : null;
    if (input.includes("image")) {
      need(/PDF parsing that includes text and page images requires models with vision capabilities/.test(doc(AUXILIARY.openaiPdf)), "OpenAI PDF support rule changed");
      input.push("pdf");
    }
    facts = { inputs: input, outputs: output, context: { tokens: context, kind: "total", ...(maxInput ? { maxInput: count(maxInput) } : {}) }, output: { tokens: maxOutput }, reasoning: { levels, default: null, mode: section.includes("Reasoning token support") ? "Reasoning supported" : null }, pricing: { input: rate("Input"), output: rate("Output"), changes: [], ...(longContext ? { longContext } : {}), note: "Standard text-token rates. Caching, Batch, Flex, Fast mode and tools have separate rates." }, access: "OpenAI API" };
  } else if (provider === "claude") {
    const $ = html(detail);
    $("main p, main li, main aside").each((_, element) => rejectUnknownPriceConditions(clean($(element).text()), "Claude"));
    const priceLists = $("main dl").filter((_, el) => $(el).find("dt").toArray().some((dt) => clean($(dt).text()) === "Input"));
    need(priceLists.length === 1, "Claude pricing section missing or ambiguous");
    const priceKeys = ["Input", "Output", "5m cache write", "1h cache write", "Cache read", "Batch API"].sort();
    need(JSON.stringify(priceLists.find("dt").map((_, el) => clean($(el).text())).get().sort()) === JSON.stringify(priceKeys), "Claude: unrecognized pricing field");
    need(priceLists.find("dd").length === priceKeys.length, "Claude: unexpected pricing value");
    priceLists.find("dt").each((_, el) => {
      const text = clean($(el).next("dd").text());
      if (clean($(el).text()) === "Batch API") need(/^\d+% discount on input and output$/.test(text), "Claude: unrecognized batch pricing qualifier");
      else exactRate(text);
    });
    const priceRemainder = priceLists.clone(); priceRemainder.find("dt,dd").remove();
    need(!clean(priceRemainder.text()), "Claude: unrecognized pricing footnote");
    const priceSurrounding = priceLists.parent().parent().clone(); priceSurrounding.find("dl").remove();
    need(/^Pricing\s*Full price list$/.test(clean(priceSurrounding.text())), "Claude: unrecognized pricing section or qualifier");
    const pairs = new Map<string, string>();
    $("main dt").each((_, el) => { pairs.set(clean($(el).text()), clean($(el).next("dd").text())); });
    const value = (key: string) => { const v = pairs.get(key); need(v, `Claude specification missing: ${key}`); return v; };
    const price = (key: string) => exactRate(clean(priceLists.find("dt").filter((_, el) => clean($(el).text()) === key).next("dd").text()));
    need(value("Claude API") === candidate.id, "Claude detail identity mismatch");
    need(clean($("h1").first().text()).startsWith(candidate.name), "Claude detail name mismatch");
    need(/^Active(?: \(latest\))?$/.test(value("Status")), "Claude model is not active");
    const modes = value("Input → output").split("→"); need(modes.length === 2, "Claude modalities missing");
    const inputs = modalities(modes[0]);
    need(/All active (?:Claude )?models support PDF processing\./.test(clean(html(doc(AUXILIARY.claudePdf))("main").text())), "Claude PDF support rule changed");
    inputs.push("pdf");
    const effortText = clean(html(doc(AUXILIARY.claudeEffort))("main").text());
    const allFive = effortText.includes(`${candidate.name} supports all five effort levels.`);
    facts = { inputs, outputs: modalities(modes[1]), context: { tokens: count(value("Context window")), kind: "context" }, output: { tokens: count(value("Max output")) }, reasoning: { mode: value("Thinking"), default: value("Default effort"), levels: allFive ? ["low", "medium", "high", "xhigh", "max"] : null }, pricing: { input: price("Input"), output: price("Output"), changes: [], note: "Standard Claude API token rates. Caching, batch processing, tools and cloud-platform rates are separate." }, access: "Claude API; cloud-platform availability and prices can differ" };
  } else {
    const $ = html(detail);
    const data = new Map<string, string>();
    $("td.gemini-api-model-table-grid section").each((_, el) => { const s = $(el); data.set(clean(s.find("b").first().text()), clean(s.find("p").filter((__, p) => !$(p).find("b").length).first().text())); });
    const value = (key: string) => { const v = data.get(key); need(v, `Gemini specification missing: ${key}`); return v; };
    const tableText = clean($("table").text());
    need(tableText.includes(`Stable: ${candidate.id}`), "Gemini stable identity mismatch");
    const codeRow = $("tr").filter((_, e) => /Model code$/.test(clean($(e).find("td,th").first().text())));
    need(clean(codeRow.find("td").last().text()) === candidate.id, "Gemini model code mismatch");
    const shared = data.get("Context window (unified input and output token limit)");
    const tokenCount = count(shared ?? value("Input token limit"));
    const max = data.get("Max output") ?? value("Output token limit");
    const extended = max.match(/^([\d,]+) \(default synchronous\) \/ up to ([\d,]+) \(with long decode\)$/);
    const price$ = html(doc(AUXILIARY.geminiPricing));
    const heading = price$(`[id="${candidate.id}"]`);
    need(heading.length === 1 && clean(heading.text()) === candidate.name, "Gemini pricing identity mismatch");
    const priceScope = heading.closest(".models-section").nextUntil(".models-section");
    const standard = priceScope.find("section").filter((_, s) => clean(price$(s).find("h3").first().text()) === "Standard");
    need(standard.length === 1, "Gemini standard pricing section missing or ambiguous");
    const surrounding = standard.clone(); surrounding.find("table,h3").remove();
    need(!clean(surrounding.text()), "Gemini: unrecognized standard pricing qualifier");
    priceScope.filter("p").add(priceScope.find("p").not("section p")).each((_, element) => {
      const prose = clean(price$(element).text());
      if (!prose.startsWith("* A customer-submitted request to Gemini")) rejectUnknownPriceConditions(prose, "Gemini");
    });
    const table = standard.find("table");
    need(table.length === 1 && !table.find("tfoot,caption").length, "Gemini: unrecognized standard pricing footnote or table");
    const tableRemainder = table.clone(); tableRemainder.find("thead,tbody").remove();
    need(!clean(tableRemainder.text()), "Gemini: unrecognized pricing table content");
    table.find("tbody tr").each((_, row) => need(/^(?:Input price|Output price(?: \(including thinking tokens\))?|Context caching price|Grounding with Google (?:Search\*?|Maps)|Used to improve our products)$/.test(clean(price$(row).find("td").first().text())), "Gemini: unrecognized standard pricing row"));
    const headers = table.find("thead th").map((_, e) => clean(price$(e).text())).get();
    const paid = headers.indexOf("Paid Tier, per 1M tokens in USD"); need(paid >= 0, "Gemini pricing unit/currency changed");
    const rate = (label: RegExp) => {
      const rows = table.find("tbody tr").filter((_, e) => label.test(clean(price$(e).find("td").first().text())));
      need(rows.length === 1, "Gemini token price row missing or ambiguous");
      return scheduledRate(clean(rows.find("td").eq(paid).text()));
    };
    const input = rate(/^Input price$/), output = rate(/^Output price(?: \(including thinking tokens\))?$/);
    need(input.change?.date === output.change?.date, "Gemini input/output schedules differ");
    const thinking = data.get("Thinking")?.match(/^Supported \(([^)]+)\)$/)?.[1];
    const restriction = clean(priceScope.filter("aside").add(priceScope.find("aside")).text());
    need(!restriction || restriction === `Note: ${candidate.name} is not available on the Free tier or on the Google AI Pro plan.`, "Unrecognized Gemini access/price restriction");
    facts = { inputs: modalities(value("Inputs")), outputs: modalities(value("Output")), context: { tokens: tokenCount, kind: shared ? "shared" : "input" }, output: extended ? { tokens: count(extended[1]), extended: count(extended[2]) } : { tokens: count(max) }, reasoning: { levels: thinking ? thinking.split(",").map((v) => v.trim()) : null, mode: null, default: null }, pricing: { input: input.initial, output: output.initial, changes: input.change && output.change ? [{ effectiveAt: input.change.date, input: input.change.value, output: output.change.value }] : [], note: "Standard paid API rates; output includes thinking tokens. Caching, batch, service tiers and grounding have separate rates." }, access: restriction ? "Paid Gemini API; unavailable on the free tier or Google AI Pro" : "Paid Gemini API; check the source for free-tier availability" };
  }
  return frontierFactsSchema.parse({
    ...facts, schemaVersion: FRONTIER_SCHEMA_VERSION, parserVersion: FRONTIER_PARSER_VERSION,
    provider, id: candidate.id, name: candidate.name, selectionRule: candidate.rule,
    sources: documents.map((d) => ({ url: d.url.replace(/\.md$/, ""), hash: d.hash,
      label: d.url === LINEUPS[provider] ? "Current model lineup" : d.url === candidate.url ? "Model specifications" : d.url.includes("pricing") ? "API pricing" : d.url.includes("effort") ? "Reasoning controls" : "PDF support",
      fields: d.url === LINEUPS[provider] ? ["selection"] : d.url === candidate.url ? ["identity", "context", "output", "modalities", "reasoning", ...(provider !== "gemini" ? ["pricing"] : [])] : d.url.includes("pricing") ? ["pricing", "access"] : d.url.includes("effort") ? ["reasoning"] : ["pdf"],
    })),
  });
}
