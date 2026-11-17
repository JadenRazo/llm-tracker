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

// The Gemini docs are Markdoc: Markdown plus `{% tag attr="value" %}` blocks.
const attributes = (raw: string) => Object.fromEntries([...raw.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])) as Record<string, string | undefined>;
function markdocCards(body: string): { attrs: Record<string, string | undefined>; body: string }[] {
  return [...body.matchAll(/\{% card ((?:[a-z-]+="[^"]*"\s*)+)%\}([\s\S]*?)\{% \/card %\}/g)].map((m) => ({ attrs: attributes(m[1]), body: m[2] }));
}
const plain = (raw: string) => clean(raw.replace(/\{% sup %\}\s*\*\s*\{% \/sup %\}/g, "*").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
/** Rows of a Markdoc list-table; a cell starts at a two-space `* ` bullet. */
function markdocRows(table: string): string[][] {
  return table.split(/\n[ \t]*---[ \t]*(?=\n)/).map((row) => row.split(/^ {2}\* +/m).slice(1).map((cell) => cell.trim())).filter((cells) => cells.length);
}
function onlyBlock(body: string, pattern: RegExp, message: string): string {
  const found = [...body.matchAll(pattern)];
  need(found.length === 1, message);
  return found[0][1];
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
    for (const card of markdocCards(body)) {
      if (card.attrs.variant !== "model-card") continue;
      // Google has used each of these phrasings for its top reasoning model.
      if (!/^Our (?:strongest|most capable|flagship) reasoning model\b/i.test(clean(card.attrs.description ?? ""))) continue;
      if (card.attrs.badge && !/^(?:New|Stable)$/i.test(card.attrs.badge)) continue;
      const id = card.body.match(/\*Model code\*\s+\*\*([a-z0-9.-]+)\*\*/)?.[1];
      need(id && card.attrs.title, "Gemini candidate identity missing");
      candidates.push({ id, name: clean(card.attrs.title), url: `https://aistudio.google.com/docs/models/${id}.md`, rule: "gemini-stable-reasoning" });
    }
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
      const rows = [...pricing.matchAll(new RegExp(`^\\| ${name} \\| \\$([\\d.]+) \\| 1M tokens \\|$`, "gm"))];
      need(rows.length === 1, rows.length ? "OpenAI standard per-million price is ambiguous" : "OpenAI standard per-million price missing"); return Number(rows[0][1]);
    };
    let longContext: FrontierFacts["pricing"]["longContext"];
    // Every note under the text-token table must match a reviewed template.
    // OpenAI reworded all of them for GPT-6.2; unknown wording still holds
    // publication, and the message names the line so health shows what changed.
    const tiers = new Set<string>();
    for (const line of pricing.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("|"))) {
      const long = line.match(/^- Prompts with more than ([\d,.]+[KM]?) input tokens are priced at ([\d.]+)x input and cache rates and ([\d.]+)x output for the full request\.$/);
      const longDoubled = line.match(/^- For requests with more than ([\d,.]+[KM]?) input tokens, input and cache rates double and output costs ([\d.]+) times the short-context rate for the full request\.$/);
      if (long || longDoubled) {
        need(!longContext, "Conflicting long-context prices");
        longContext = long ? { above: count(long[1]), inputMultiplier: Number(long[2]), outputMultiplier: Number(long[3]) }
          : { above: count(longDoubled![1]), inputMultiplier: 2, outputMultiplier: Number(longDoubled![2]) };
      } else if (/^- Batch and Flex are priced at [\d.]+% of Standard rates\. Fast mode is priced at [\d.]+x the applicable rates\.$/.test(line)) { tiers.add("Batch"); tiers.add("Flex"); tiers.add("Fast mode"); }
      else if (/^- Batch costs [\d.]+% of Standard rates\. Fast mode costs (?:twice|[\d.]+ times) the Standard rate for the same context length\.$/.test(line)) { tiers.add("Batch"); tiers.add("Fast mode"); }
      else if (/^- Ultrafast costs [\d.]+ times the Standard rate through [A-Z][a-z]+ \d{1,2}, \d{4}, and [\d.]+ times the Standard rate starting [A-Z][a-z]+ \d{1,2}, \d{4} \(Pacific time\)\.$/.test(line)) tiers.add("Ultrafast");
      else need(/^- Cache writes are billed at [\d.]+x the uncached input token rate\.$/.test(line)
        || /^- The cache write price is for \d+ minutes of retention\. A \d+-hour cache write costs \$[\d.]+ per million tokens for short-context requests at Standard pricing\.$/.test(line),
        `Unrecognized OpenAI pricing qualifier: ${line.replace(/[^\x20-\x7E]/g, "?").slice(0, 80)}`);
    }
    // Name only the processing tiers this model's page actually lists.
    const separate = ["Caching", ...["Batch", "Flex", "Fast mode", "Ultrafast"].filter((t) => tiers.has(t))];
    const pricingNote = tiers.size ? `Standard text-token rates. ${separate.slice(0, -1).join(", ")} and ${separate.at(-1)} have separate rates, as do tools.` : "Standard text-token rates. Caching and tools have separate rates.";
    const reasoning = detail.match(/`reasoning\.effort` supports ([^\n]+)\./)?.[1];
    const levels = reasoning ? [...reasoning.matchAll(/`([a-z]+)`/g)].map((m) => m[1]) : null;
    if (input.includes("image")) {
      need(/PDF parsing that includes text and page images requires models with vision capabilities/.test(doc(AUXILIARY.openaiPdf)), "OpenAI PDF support rule changed");
      input.push("pdf");
    }
    facts = { inputs: input, outputs: output, context: { tokens: context, kind: "total", ...(maxInput ? { maxInput: count(maxInput) } : {}) }, output: { tokens: maxOutput }, reasoning: { levels, default: null, mode: section.includes("Reasoning token support") ? "Reasoning supported" : null }, pricing: { input: rate("Input"), output: rate("Output"), changes: [], ...(longContext ? { longContext } : {}), note: pricingNote }, access: "OpenAI API" };
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
    // Model page: one Markdoc property table. Every value is read from its own
    // labelled row, and identity is checked three ways before anything is used.
    need(detail.match(/^# (.+)$/m)?.[1].trim() === candidate.name, "Gemini detail name mismatch");
    const properties = new Map<string, string>();
    for (const cells of markdocRows(onlyBlock(detail, /\{% table variant="model" %\}([\s\S]*?)\{% \/table %\}/g, "Gemini specification table missing or ambiguous"))) {
      if (cells.length !== 2) continue;
      const label = clean(cells[0].replace(/\{% sup %\}[\s\S]*?\{% \/sup %\}/g, "").replace(/\{%[^%]*%\}/g, ""));
      need(!properties.has(label), `Gemini specification repeated: ${label}`);
      properties.set(label, cells[1]);
    }
    const property = (key: string) => { const v = properties.get(key); need(v, `Gemini specification missing: ${key}`); return v; };
    const labelled = (key: string) => new Map([...property(key).matchAll(/^[ \t]*\*\*([^*]+)\*\*[ \t]+(\S.*)$/gm)].map((m) => [clean(m[1]), plain(m[2])]));
    need(clean(property("Model code")) === `\`${candidate.id}\``, "Gemini model code mismatch");
    need(property("Versions").split("\n").some((line) => clean(line) === `* Stable: \`${candidate.id}\``), "Gemini stable identity mismatch");
    const types = labelled("Supported data types"), limits = labelled("Token limits");
    const value = (map: Map<string, string>, key: string) => { const v = map.get(key); need(v, `Gemini specification missing: ${key}`); return v; };
    const shared = limits.get("Context window (unified input and output token limit)");
    const tokenCount = count(shared ?? value(limits, "Input token limit"));
    const max = limits.get("Max output") ?? value(limits, "Output token limit");
    const extended = max.match(/^([\d,]+) \(default synchronous\) \/ up to ([\d,]+) \(with long decode\)$/);
    const thinkingBadge = property("Capabilities").match(/\[\*\*Thinking\*\*\]\([^)]*\)\s*\{% badge ([^%]*?)\/%\}/)?.[1] ?? "";
    const thinking = /type="supported"/.test(thinkingBadge) ? thinkingBadge.match(/label=Supported \(([^)]+)\)/)?.[1] : undefined;

    // Pricing page: this model's own section, then only its Standard tab.
    const prices = doc(AUXILIARY.geminiPricing);
    const headings = [...prices.matchAll(/^## (.+?)[ \t]+\{% id="([^"]+)" %\}[ \t]*$/gm)].filter((h) => h[2] === candidate.id);
    need(headings.length === 1 && clean(headings[0][1]) === candidate.name, "Gemini pricing identity mismatch");
    const from = headings[0].index! + headings[0][0].length, rest = prices.slice(from), nextSection = rest.search(/^## /m);
    const scope = nextSection < 0 ? rest : rest.slice(0, nextSection);
    const tabs = onlyBlock(scope, /\{% tabs %\}([\s\S]*?)\{% \/tabs %\}/g, "Gemini pricing tiers missing or ambiguous");
    // Nothing may sit inside the tier block but outside a tier.
    need(!clean(tabs.replace(/\{% tab title="[^"]*" %\}[\s\S]*?\{% \/tab %\}/g, "")), "Gemini: unrecognized content between pricing tiers");
    // Outside the tiers: an identity/try-it header, a description and access notes.
    // The header is layout around a model code and a button; its words are still read.
    const layouts = [...scope.matchAll(/\{% two-column-layout %\}([\s\S]*?)\{% \/two-column-layout %\}/g)].map((m) => plain(m[1].replace(/\{%[^%]*%\}/g, " ")));
    for (const layout of layouts) rejectUnknownPriceConditions(layout, "Gemini");
    let preamble = scope.replace(/\{% tabs %\}[\s\S]*?\{% \/tabs %\}/g, "").replace(/\{% two-column-layout %\}[\s\S]*?\{% \/two-column-layout %\}/g, "").replace(/\{% hr \/%\}/g, "");
    const callouts = [...preamble.matchAll(/\{% callout type="note" %\}([\s\S]*?)\{% \/callout %\}/g)].map((m) => plain(m[1]));
    preamble = preamble.replace(/\{% callout type="note" %\}[\s\S]*?\{% \/callout %\}/g, "");
    need(!/\{%|^[ \t]*\|/m.test(preamble), "Gemini: unrecognized pricing section content");
    for (const paragraph of preamble.split(/\n\s*\n/)) rejectUnknownPriceConditions(plain(paragraph), "Gemini");
    const standardTabs = [...tabs.matchAll(/\{% tab title="([^"]+)" %\}([\s\S]*?)\{% \/tab %\}/g)].filter((t) => t[1] === "Standard");
    need(standardTabs.length === 1, "Gemini standard pricing section missing or ambiguous");
    const standard = standardTabs[0][2];
    const rows = markdocRows(onlyBlock(standard, /\{% table %\}([\s\S]*?)\{% \/table %\}/g, "Gemini: unrecognized standard pricing footnote or table")).map((cells) => cells.map(plain));
    const searchBillingNote = "* A customer-submitted request to Gemini may result in one or more queries to Google Search. You will be charged for each individual search query performed.";
    // Google repeats this tool-billing footnote inside each service tier.
    // Accept only its exact reviewed wording; unknown token qualifiers still fail.
    const surrounding = plain(standard.replace(/\{% table %\}[\s\S]*?\{% \/table %\}/g, ""));
    const hasSearchBillingNote = surrounding === searchBillingNote;
    need(!surrounding || hasSearchBillingNote, "Gemini: unrecognized standard pricing qualifier");
    const [headers, ...body] = rows;
    need(headers?.length === 3 && body.length && body.every((cells) => cells.length === 3), "Gemini: unrecognized pricing table content");
    for (const cells of body) need(/^(?:Input price|Output price(?: \(including thinking tokens\))?|Context caching price|Grounding with Google (?:Search\*?|Maps)|Used to improve our products)$/.test(cells[0]), "Gemini: unrecognized standard pricing row");
    const paid = headers.indexOf("Paid Tier, per 1M tokens in USD"); need(paid >= 0, "Gemini pricing unit/currency changed");
    const rate = (label: RegExp) => {
      const matching = body.filter((cells) => label.test(cells[0]));
      need(matching.length === 1, "Gemini token price row missing or ambiguous");
      return scheduledRate(matching[0][paid]);
    };
    const input = rate(/^Input price$/), output = rate(/^Output price(?: \(including thinking tokens\))?$/);
    need(input.change?.date === output.change?.date, "Gemini input/output schedules differ");
    // Contributor/Batch/etc. access notes live inside their own tabs and do not
    // describe Standard API access; the Standard tab's own asides failed above.
    const restriction = callouts.join(" ").replace(/^Note: /, "");
    const excludesPro = restriction === `${candidate.name} is not available on the Free tier or on the Google AI Pro plan.`;
    const billsAllTokens = restriction === `${candidate.name} is not available on the Free tier. Every token the model processes is counted and billed, including thinking tokens and internal tool system instructions and function declarations when using grounding.`;
    need(!restriction || excludesPro || billsAllTokens, "Unrecognized Gemini access/price restriction");
    const billingNotes = [
      "Standard paid API rates; output includes thinking tokens. Caching, batch, service tiers and grounding have separate rates.",
      billsAllTokens ? "Every processed token is billed, including internal tool system instructions and function declarations when grounding." : "",
      hasSearchBillingNote ? "Google Search grounding is billed per individual search query." : "",
    ].filter(Boolean).join(" ");
    facts = { inputs: modalities(value(types, "Inputs")), outputs: modalities(value(types, "Output")), context: { tokens: tokenCount, kind: shared ? "shared" : "input" }, output: extended ? { tokens: count(extended[1]), extended: count(extended[2]) } : { tokens: count(max) }, reasoning: { levels: thinking ? thinking.split(",").map((v) => v.trim()) : null, mode: null, default: null }, pricing: { input: input.initial, output: output.initial, changes: input.change && output.change ? [{ effectiveAt: input.change.date, input: input.change.value, output: output.change.value }] : [], note: billingNotes }, access: excludesPro ? "Paid Gemini API; unavailable on the free tier or Google AI Pro" : billsAllTokens ? "Paid Gemini API; unavailable on the free tier" : "Paid Gemini API; check the source for free-tier availability" };
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
