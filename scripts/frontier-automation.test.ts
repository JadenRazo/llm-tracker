import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as cheerio from "cheerio";
import { assertFrontierStatus } from "./assert-frontier-status.mjs";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db";
import { allowedDocument, frontierProviders, type FrontierProvider, type SourceDocument } from "@/lib/frontier/schema";
import { selectCandidate, parseFrontier, scheduledRate } from "@/lib/frontier/parsers";
import { documentHash, documentReader, type DocumentStore } from "@/lib/frontier/fetch-document";
import { extractFrontier, syncFrontier, restoreFrontier } from "@/lib/frontier/sync";
import { migrateFrontier } from "@/lib/frontier/migration";
import { readFrontier } from "@/lib/frontier/read";
import { frontierHealth } from "@/lib/frontier/health";
import { presentFrontier, taskGuidance } from "@/lib/frontier/presentation";
import { comparisonHref, comparisonSelection, modelPrice } from "@/lib/frontier-models";
import { isUnknownPath } from "@/middleware";
import { parseModelCards, parseModelDetail } from "@/lib/sources/gemini/gemini_models";

const fixture = JSON.parse(readFileSync("scripts/fixtures/frontier/documents.json", "utf8")).providers as Record<FrontierProvider, {url: string; body: string}[]>;
const docs = (provider: FrontierProvider): SourceDocument[] => fixture[provider].map((d) => ({ ...d, hash: documentHash(d.body) }));
const parse = (provider: FrontierProvider, documents = docs(provider)) => parseFrontier(provider, selectCandidate(provider, documents[0].body), documents);
function memoryStore(): DocumentStore & { data: Map<string, SourceDocument> } {
  const data = new Map<string, SourceDocument>();
  return { data, load: async (url) => data.get(url) ?? null, save: async (document) => { data.set(document.url, document); } };
}
function fixtureFetch(documents = frontierProviders.flatMap(docs)): typeof fetch {
  return (async (input) => { const body = documents.find((d) => d.url === String(input))?.body; return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { etag: body ? documentHash(body) : "missing" } }); }) as typeof fetch;
}

test("official excerpts produce three profiles with fair PDFs and scoped pricing", () => {
  const claude = parse("claude"), openai = parse("openai"), gemini = parse("gemini");
  assert.equal(claude.id, "claude-fable-5-1"); assert.equal(openai.id, "gpt-6-astra"); assert.equal(gemini.id, "gemini-4-carbon");
  for (const facts of [claude, openai, gemini]) assert.ok(facts.inputs.includes("pdf"));
  assert.deepEqual(claude.reasoning.levels, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(openai.pricing.longContext?.above, 272000); assert.equal(openai.context.maxInput, 922000);
  assert.equal(gemini.context.kind, "shared"); assert.equal(gemini.output.tokens, 65536); assert.equal(gemini.output.extended, 1048576);
  assert.deepEqual(gemini.inputs, ["text", "image", "video", "audio", "pdf"]); assert.deepEqual(gemini.reasoning.levels, ["low", "medium", "high"]);
  assert.equal(gemini.selectionRule, "gemini-stable-reasoning"); // the stored shape must stay readable by the web build already deployed
  assert.deepEqual(gemini.sources.map((s) => s.url), ["https://aistudio.google.com/docs/models", "https://aistudio.google.com/docs/models/gemini-4-carbon", "https://aistudio.google.com/docs/pricing"]);
  assert.deepEqual(gemini.pricing.changes, [{ effectiveAt: "2026-12-01", input: 4, output: 20 }]);
  for (const facts of [claude, openai, gemini]) assert.ok(facts.sources.every((s) => s.fields.length && /^[a-f0-9]{64}$/.test(s.hash)));
});

test("selection follows positioning, handles a replacement, and rejects ambiguity", () => {
  const source = docs("openai")[0].body;
  assert.equal(selectCandidate("openai", source + '\n## Historical\n[GPT-999](/api/docs/models/gpt-999.md): Our flagship').id, "gpt-6-astra");
  assert.equal(selectCandidate("openai", source.replaceAll("gpt-6-astra", "gpt-7-new").replaceAll("GPT-6 Astra", "GPT-7 New")).id, "gpt-7-new");
  assert.throws(() => selectCandidate("openai", source.replace('## Featured models', '[GPT-7 New](/api/docs/models/gpt-7-new), our flagship model for complex reasoning and coding\n## Featured models')), /found 2/);
  assert.throws(() => selectCandidate("openai", source.replaceAll("gpt-6-astra", "gpt-7-preview")), /stable/);
  assert.equal(selectCandidate("claude", docs("claude")[0].body).id, "claude-fable-5-1"); // not the most-workloads Opus recommendation
  const lineup = docs("gemini")[0].body;
  assert.equal(selectCandidate("gemini", lineup).id, "gemini-4-carbon"); // not the "efficient" Argon card or the "Flagship" text-to-speech card
  assert.equal(selectCandidate("gemini", lineup).url, "https://aistudio.google.com/docs/models/gemini-4-carbon.md");
  assert.throws(() => selectCandidate("gemini", lineup.replace('title="Gemini 4 Carbon"', 'badge="Preview" title="Gemini 4 Carbon"')), /found 0/);
  assert.throws(() => selectCandidate("gemini", lineup.replace("Our efficient Gemini 4 frontier reasoning model", "Our strongest reasoning model")), /found 2/);
  assert.throws(() => selectCandidate("gemini", lineup.replaceAll("{% card ", "{% tile ")), /found 0/); // a redesign holds the last profile instead of guessing
  const unstable = docs("gemini"); unstable[1].body = unstable[1].body.replace("*   Stable: `gemini-4-carbon`", "*   Preview: `gemini-4-carbon`");
  assert.throws(() => parse("gemini", unstable), /stable identity/);
  const otherCode = docs("gemini"); otherCode[1].body = otherCode[1].body.replace("  * `gemini-4-carbon`", "  * `gemini-4-other`");
  assert.throws(() => parse("gemini", otherCode), /model code/);
});

test("identity, source drift, malformed limits and unrecognized prices hold publication", () => {
  for (const [oldText, replacement] of [["Model ID: `gpt-6-astra`", "Model ID: `gpt-other`"], ["1,050,000 context window", "huge context window"], ["1M tokens |", "1K tokens |"]]) {
    const documents = docs("openai"); documents[1].body = documents[1].body.replaceAll(oldText, replacement);
    assert.throws(() => parse("openai", documents));
  }
  const documents = docs("openai"); documents[1].body = documents[1].body.replace('## Endpoints', '- Prices double for enterprise use.\n\n## Endpoints');
  assert.throws(() => parse("openai", documents), /qualifier/);
  const unknown = docs("claude"); unknown.at(-1)!.body = "<main>Support changed</main>"; assert.throws(() => parse("claude", unknown), /PDF/);
  for (const raw of ["$2 per 1K tokens", "$2 through November 30, 2026. $4 starting December 2, 2026.", "$2 or $5 depending on context"]) assert.throws(() => scheduledRate(raw));
  for (const restriction of ["Status: Deprecated", "Availability: Partner-only preview", "- Availability: Partner-only preview", "- **Status:** Deprecated", "GPT-6 Astra is a deprecated model."]) {
    const docsWithRestriction=docs("openai");docsWithRestriction[1].body=docsWithRestriction[1].body.replace('## Model details',restriction+'\n\n## Model details');assert.throws(()=>parse("openai",docsWithRestriction),/eligibility|active/);
  }
  const retiredDetails=docs("openai");retiredDetails[1].body=retiredDetails[1].body.replace('## Model details','## Model details\n\n- Status: Deprecated');assert.throws(()=>parse("openai",retiredDetails),/eligibility/);
  for(const restriction of ['## Status\n\nDeprecated.','## Availability\n\nPartner-only preview.','## Lifecycle\n\nRetired.']) {
    const restricted=docs('openai');restricted[1].body=restricted[1].body.replace('## Pricing',restriction+'\n\n## Pricing');assert.throws(()=>parse('openai',restricted),/eligibility/);
  }
  const claudeSurcharge=docs("claude");claudeSurcharge[1].body=claudeSurcharge[1].body.replace('</main>','<p>Prompts above 200K tokens incur a surcharge of 2x.</p></main>');assert.throws(()=>parse("claude",claudeSurcharge),/pricing condition/);
  const geminiSurcharge=docs("gemini");geminiSurcharge[2].body=geminiSurcharge[2].body.replace('{% tab title="Standard" %}','{% tab title="Standard" %}\n  Prompts above 200K tokens incur a surcharge of 2x.\n');assert.throws(()=>parse("gemini",geminiSurcharge),/pricing qualifier/);
  const nestedClaude=docs("claude");const c=cheerio.load(nestedClaude[1].body);c('dl').filter((_,el)=>c(el).find('dt').toArray().some(dt=>c(dt).text()==='Input')).append('<dt>Long-context pricing</dt><dd>Prompts above 200K tokens incur a surcharge of 2x.</dd>');nestedClaude[1].body=c.html();assert.throws(()=>parse("claude",nestedClaude),/pricing field/);
  const nestedGemini=docs("gemini");nestedGemini[2].body=nestedGemini[2].body.replace('  * Used to improve our products','  * Long-context surcharge\n  * Not available\n  * 2x above 200K tokens\n\n  ---\n\n  * Used to improve our products');assert.throws(()=>parse("gemini",nestedGemini),/pricing row/);
  const proseGemini=docs("gemini");proseGemini[2].body=proseGemini[2].body.replace('{% callout type="note" %}\n  Gemini 4 Carbon','Prices double above 200K input tokens.\n\n{% callout type="note" %}\n  Gemini 4 Carbon');assert.throws(()=>parse("gemini",proseGemini),/pricing condition/);
});

test("Gemini reads one model's Standard tier and holds unknown notes or access limits", () => {
  const documents = docs("gemini");
  const facts = parse("gemini", documents);
  assert.equal(facts.pricing.input, 2);
  assert.equal(facts.pricing.output, 10);
  assert.deepEqual(facts.pricing.changes, [{ effectiveAt: "2026-12-01", input: 4, output: 20 }]);
  assert.equal(facts.access, "Paid Gemini API; unavailable on the free tier");
  assert.match(facts.pricing.note, /internal tool system instructions/);
  assert.match(facts.pricing.note, /per individual search query/);
  // The neighbouring Argon section carries an invite-only Contributor tier and
  // Batch/Flex/Priority rates; none of that belongs to Carbon's Standard price.
  assert.match(documents[2].body, /Contributor Tier is offered as a private preview/);
  assert.match(documents[2].body, /\$3\.60 through/);

  for (const change of [
    (body: string) => body.replace("query performed.", "query performed plus an extra token surcharge."),
    (body: string) => body.replace('{% tab title="Standard" %}', '{% tab title="Standard" %}\n  Prompts above 200K tokens incur a surcharge of 2x.\n'),
    (body: string) => body.replace('{% tab title="Standard" %}', '{% tab title="Standard" %}\n  {% callout type="note" %}\n  Standard is invite-only.\n\n  {% /callout %}\n'),
    (body: string) => body.replace("Every token the model processes is counted and billed", "Every token above 200K costs twice the normal rate"),
    (body: string) => body.replace('{% tab title="Standard" %}', '{% tab title="Standard pricing" %}'),
    (body: string) => body.replace("Paid Tier, per 1M tokens in USD", "Paid Tier, per 1K tokens in USD"),
    (body: string) => body.replace("$4.00 starting December 1, 2026.", "$4.00 starting December 2, 2026."),
    (body: string) => body.replace('## Gemini 4 Carbon  {% id="gemini-4-carbon" %}', '## Gemini 4 Carbon (legacy)  {% id="gemini-4-carbon" %}'),
  ]) {
    const changed = change(documents[2].body);
    assert.notEqual(changed, documents[2].body);
    assert.throws(() => parse("gemini", documents.map((document, i) => i === 2 ? { ...document, body: changed } : document)), /qualifier|restriction|standard pricing section|unit|schedule|gap|identity/);
  }
});

test("price dates and guidance use current facts and exclude stale recommendations", () => {
  const now = new Date();
  const models = frontierProviders.map((p) => presentFrontier({ id: p, facts: parse(p), verifiedAt: now.toISOString() }, {provider:p, revisionId:p, error:null, paused:false, attemptedAt:now.toISOString()}, now));
  const gemini = models[2]; assert.deepEqual(modelPrice(gemini, "2026-11-30"), {input:2,output:10}); assert.deepEqual(modelPrice(gemini, "2026-12-01"), {input:4,output:20});
  const textGemini={...parse('gemini'),inputs:['text'] as const};
  const futureGemini=presentFrontier({id:'future',facts:{...textGemini,inputs:[...textGemini.inputs]},verifiedAt:now.toISOString()},undefined,now);assert.match(futureGemini.summary,/Google/);assert.doesNotMatch(futureGemini.summary,/OpenAI/);
  assert.match(taskGuidance(models, "2026-12-01")[3].title, /Gemini/);
  const stale = models.map((m) => ({...m, freshness:"stale" as const})); assert.doesNotMatch(taskGuidance(stale, "2026-12-01")[3].title, /Gemini/);
  const successor = {...models[1], id:"gpt-7-new", name:"GPT-7 New"}; const available=[models[0],successor,models[2],{...models[1],freshness:"archived" as const}];
  assert.equal(isUnknownPath('/models/gpt-7-new'), false);
  assert.deepEqual(comparisonSelection(null, available).map(m=>m.id),available.slice(0,3).map(m=>m.id));
  assert.match(comparisonHref(["gpt-6-astra","gpt-7-new"], available), /gpt-6-astra/);
});

// Regression: after Google moved its docs on 2026-11-02 the catalog adapter
// parsed zero cards on every run, so Gemini 4 Carbon and Hydrogen never appeared.
test("Gemini catalog reads both card forms from the Markdown lineup, keyed by docs slug", () => {
  const cards = parseModelCards(docs("gemini")[0].body);
  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.equal(cards.length, byId.size);
  for (const [id, name] of [["gemini-4-carbon", "Gemini 4 Carbon"], ["gemini-4-argon", "Gemini 4 Argon"], ["gemini-4-hydrogen", "Gemini 4 Hydrogen"]]) assert.equal(byId.get(id)?.displayName, name);
  assert.deepEqual([byId.get("gemini-3.8-flash")?.displayName, byId.get("gemini-3.8-flash")?.releaseStage], ["Gemini 3.8 Flash", "Stable"]);
  assert.equal(byId.get("gemini-3-flash-preview")?.releaseStage, "Preview");
  assert.equal(cards.length, 21); // cards only: the "All models" endpoint tables would re-announce old models
  assert.ok(!byId.has("gemini-3.1-pro-preview"));
  assert.deepEqual(parseModelCards("<html><a href=\"/gemini-api/docs/models/x\"><h3>X</h3></a></html>"), []);
});

test("Gemini catalog reads token limits in both label styles, and capabilities", () => {
  const carbon = parseModelDetail(docs("gemini")[1].body);
  assert.deepEqual([carbon.contextWindow, carbon.maxOutput], [1048576, 65536]);
  assert.deepEqual([carbon.capabilities.thinking, carbon.capabilities.functionCalling, carbon.capabilities.imageGeneration, carbon.capabilities.liveApi], [true, true, false, false]);
  const earlier = parseModelDetail("  *     **Input token limit** 1,048,576\n\n    **Output token limit** 65,536\n");
  assert.deepEqual([earlier.contextWindow, earlier.maxOutput], [1048576, 65536]);
  assert.deepEqual(parseModelDetail("no limits here"), { contextWindow: null, maxOutput: null, capabilities: {} });
});

// Regression: on 2026-11-17 OpenAI launched GPT-6.2 Astra and GPT-6.2 Sol and
// reworded every pricing note. The profile refresh rejected Astra with
// "Unrecognized OpenAI pricing qualifier" and kept serving GPT-6 Astra.
const launch = (JSON.parse(readFileSync("scripts/fixtures/frontier/openai-2026-11-17.json", "utf8")).documents as {url: string; body: string}[]).map((d) => ({ ...d, hash: documentHash(d.body) }));
test("GPT-6.2 launch: Astra is selected and its reworded pricing notes are accepted", () => {
  const candidate = selectCandidate("openai", launch[0].body);
  assert.deepEqual([candidate.id, candidate.name], ["gpt-6.2-astra", "GPT-6.2 Astra"]); // Sol is named beside it, as the balanced choice
  const facts = parseFrontier("openai", candidate, launch.slice(0, 3));
  assert.deepEqual([facts.pricing.input, facts.pricing.output], [8, 40]);
  assert.deepEqual(facts.pricing.longContext, { above: 272000, inputMultiplier: 2, outputMultiplier: 1.5 });
  assert.deepEqual(facts.context, { tokens: 1050000, kind: "total", maxInput: 922000 });
  assert.equal(facts.output.tokens, 128000);
  assert.deepEqual(facts.inputs, ["text", "image", "pdf"]);
  assert.equal(facts.pricing.note, "Standard text-token rates. Caching, Batch, Fast mode and Ultrafast have separate rates, as do tools."); // no Flex tier on this page
  assert.equal(facts.reasoning.levels, null); // the page no longer lists effort levels; say so instead of guessing
  assert.match(presentFrontier({ id: "r", facts, verifiedAt: new Date().toISOString() }, undefined).reasoning, /Effort levels not verified/);
});

test("GPT-6.2 launch: Sol's page parses too, and stays a separate model", () => {
  const sol = { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", url: launch[3].url, rule: "openai-intro-flagship" as const };
  const facts = parseFrontier("openai", sol, [launch[0], launch[3], launch[2]]);
  assert.deepEqual([facts.id, facts.name, facts.pricing.input, facts.pricing.output], ["gpt-6.2-sol", "GPT-6.2 Sol", 2, 10]);
  assert.throws(() => parseFrontier("openai", sol, launch.slice(0, 3)), /Missing document/); // never built from Astra's page
  assert.throws(() => parseFrontier("openai", { ...sol, url: launch[1].url }, launch.slice(0, 3)), /identity mismatch/);
});

test("GPT-6.2 launch: wording that is still unknown holds publication and is named", () => {
  for (const [from, to] of [
    ["- Batch costs 50% of Standard rates.", "- Batch costs 50% of Standard rates for approved partners."],
    ["input and cache rates double and output costs 1.5 times", "input and cache rates triple and output costs 1.5 times"],
    ["- Ultrafast costs 3 times the Standard rate through February 28, 2027", "- Ultrafast and Standard cost 3 times the listed rate through February 28, 2027"],
    ["## Endpoints", "- Requests from new accounts are billed at 2x.\n\n## Endpoints"],
  ]) {
    const documents = launch.slice(0, 3).map((d, i) => i === 1 ? { ...d, body: d.body.replace(from, to) } : d);
    assert.notEqual(documents[1].body, launch[1].body);
    assert.throws(() => parseFrontier("openai", selectCandidate("openai", documents[0].body), documents), /Unrecognized OpenAI pricing qualifier: - /);
  }
});

test("conditional fetch reuses matching bodies, retries orphan 304 and rejects unsafe URLs/statuses", async () => {
  const url=docs("openai")[0].url; const store=memoryStore();
  const first=await documentReader("openai",store,fixtureFetch())(url);
  let received: HeadersInit | undefined;
  const unchanged=(async (_url, options)=>{received=options?.headers;return new Response(null,{status:304});}) as typeof fetch;
  assert.deepEqual(await documentReader("openai",store,unchanged)(url),first); assert.equal((received as Record<string,string>)["If-None-Match"],first.etag);
  let calls=0; const orphan=(async()=>++calls===1?new Response(null,{status:304}):new Response("valid body")) as typeof fetch;
  await documentReader("openai",memoryStore(),orphan)(url); assert.equal(calls,2);
  for(const status of [302,429,500]) await assert.rejects(documentReader("openai",store,(async()=>new Response(null,{status})) as typeof fetch)(url),new RegExp(String(status)));
  await assert.rejects(documentReader("openai",store,(async()=>new Response("x",{headers:{"content-length":String(3*1024*1024)}})) as typeof fetch)(url),/2 MiB/);
  await assert.rejects(documentReader("openai",store,(async()=>{throw new Error("timeout");}) as typeof fetch)(url),/timeout/);
  for(const raw of ["http://developers.openai.com/api/docs/models.md","https://developers.openai.com.evil.test/api/docs/models.md","https://user:pass@developers.openai.com/api/docs/models.md","https://127.0.0.1/private","https://developers.openai.com/api/docs/models.md?key=private"]) assert.equal(allowedDocument("openai",raw),false);
  const geminiUrl = docs("gemini")[0].url;
  assert.equal(allowedDocument("gemini", geminiUrl), true);
  assert.equal(allowedDocument("gemini", "https://aistudio.google.com/docs/models/gemini-4-carbon.md"), true);
  for (const bad of [geminiUrl + "?hl=en", geminiUrl.replace(/\.md$/, ""), "https://ai.google.dev/gemini-api/docs/models?hl=en", "https://aistudio.google.com/prompts/new_chat.md", "https://aistudio.google.com/docs/../prompts/models.md", "https://aistudio.google.com.evil.test/docs/models.md"]) assert.equal(allowedDocument("gemini", bad), false, bad);
  // The 2026-11-02 move answered the old URLs with a redirect; never follow one.
  await assert.rejects(documentReader("gemini", memoryStore(), (async () => new Response(null, {status:301, headers:{location:"https://evil.test/"}})) as typeof fetch)(geminiUrl), /301/);
});

test("unchanged index still refreshes details, and rejected cached content is parsed again", async () => {
  const store=memoryStore(); await extractFrontier("openai",store,fixtureFetch());
  const documents=docs("openai"); documents[1].body=documents[1].body.replace('| Input | $10 |','| Input | $12 |');
  const mixed=(async(input)=>String(input)===documents[0].url?new Response(null,{status:304}):fixtureFetch(documents)(input)) as typeof fetch;
  const updated=await extractFrontier("openai",store,mixed); assert.equal(updated.facts.pricing.input,12);
  documents[1].body=documents[1].body.replace('1,050,000 context window','unknown context window');
  await assert.rejects(extractFrontier("openai",store,mixed));
  await assert.rejects(extractFrontier("openai",store,(async()=>new Response(null,{status:304})) as typeof fetch));
});

test("DB outage preserves a post-deployment model ID as unavailable", async () => {
  const result=await readFrontier("gpt-7-new",null);
  assert.equal(result.unavailable,true); assert.deepEqual(result.missingIds,["gpt-7-new"]); assert.equal(result.current.length,3); assert.ok(result.current.every(m=>m.freshness==="fallback"));
});

test("release gate rejects fallback-only, skipped, stale and missing profiles", () => {
  for (const bad of [{ok:false,providers:[]},{ok:true,providers:[]},{ok:true,providers:[{provider:"claude",status:"current"}]}]) assert.throws(()=>assertFrontierStatus(bad));
  const accepted={ok:true,providers:frontierProviders.map(provider=>({provider,status:"current",modelId:parse(provider).id,revisionId:"a".repeat(64),verifiedAt:new Date().toISOString(),sourceHashes:parse(provider).sources}))};
  assert.doesNotThrow(()=>assertFrontierStatus(accepted));
  for(const status of ["fallback","skipped","stale","failed","missing"]) {
    const bad=structuredClone(accepted);bad.providers[0].status=status;assert.throws(()=>assertFrontierStatus(bad));
  }
});

const testUrl=process.env.FRONTIER_TEST_DATABASE_URL;
test("isolated PostgreSQL: migration, atomicity, history, recovery, concurrency and outage", {skip:!testUrl}, async () => {
  const url=new URL(testUrl!); assert.ok(["127.0.0.1","localhost"].includes(url.hostname)); assert.equal(url.pathname,"/frontier_test");
  const pool=new Pool({connectionString:testUrl,max:5}); const db=drizzle(pool,{schema}) as Database;
  try {
    await db.execute(sql`drop table if exists frontier_states, frontier_revisions, frontier_documents cascade`);
    assert.equal((await syncFrontier("openai",db,fixtureFetch())).status,"skipped");
    const interrupted = { transaction: (callback: (tx: unknown) => Promise<void>) => db.transaction(async (tx) => {
      let statements=0;
      const wrapped = new Proxy(tx, { get(target, property, receiver) {
        if(property === "execute") return async (query: Parameters<typeof tx.execute>[0]) => { if(++statements===5) throw new Error("Interrupted migration"); return tx.execute(query); };
        return Reflect.get(target,property,receiver);
      }});
      return callback(wrapped);
    }) } as unknown as Database;
    await assert.rejects(migrateFrontier(interrupted),/Interrupted migration/);
    assert.equal((await db.execute<{name:string|null}>(sql`select to_regclass('frontier_documents')::text as name`)).rows[0].name,null);
    await migrateFrontier(db); await migrateFrontier(db);
    const empty=await readFrontier("gpt-7-new",db); assert.equal(empty.unavailable,false); assert.equal(empty.current[0].freshness,"fallback");
    for(const provider of frontierProviders) await syncFrontier(provider,db,fixtureFetch());
    let health=await frontierHealth(db); assert.equal(health.ok,true); assert.equal(health.providers.length,3); assertFrontierStatus(health);
    const original=health.providers.find(p=>p.provider==="openai")!; const before=await readFrontier("",db); assert.ok(before.current.every(m=>m.freshness==="current"));
    await db.execute(sql`create or replace function frontier_test_reject() returns trigger language plpgsql as $$begin raise exception 'fixture publication failure'; end$$`);
    await db.execute(sql`create trigger frontier_test_reject before insert or update on frontier_revisions for each row execute function frontier_test_reject()`);
    await assert.rejects(syncFrontier("openai",db,fixtureFetch()), (error: unknown) => error instanceof Error && /Database publication failed/.test(error.message) && !/Failed query|Model ID/.test(error.message));
    assert.equal((await frontierHealth(db)).providers.find(p=>p.provider==='openai')!.status,'failed');
    const failedSqlHealth=await frontierHealth(db); assert.throws(()=>assertFrontierStatus(failedSqlHealth));
    await db.execute(sql`drop trigger frontier_test_reject on frontier_revisions`);
    await syncFrontier("openai",db,fixtureFetch());
    const reverified=(await frontierHealth(db)).providers.find(p=>p.provider==='openai')!;
    const bad=docs("openai"); bad[1].body="broken"; await assert.rejects(syncFrontier("openai",db,fixtureFetch(bad)));
    health=await frontierHealth(db); const afterFailure=health.providers.find(p=>p.provider==="openai")!;
    assert.equal(afterFailure.revisionId,reverified.revisionId); assert.equal(afterFailure.verifiedAt,reverified.verifiedAt); assert.equal(afterFailure.status,"failed");
    const evidence=await db.select().from(schema.frontierRevisions); assert.ok(JSON.stringify(evidence).includes('Model ID: `gpt-6-astra`'));
    const replacement=docs("openai").map(d=>({...d,url:d.url.replaceAll('gpt-6-astra','gpt-7-new'),body:d.body.replaceAll('gpt-6-astra','gpt-7-new').replaceAll('GPT-6 Astra','GPT-7 New')}));
    await syncFrontier("openai",db,fixtureFetch(replacement));
    const history=await readFrontier('gpt-6-astra,gpt-7-new',db); assert.ok(history.current.some(m=>m.id==='gpt-7-new')); assert.ok(history.available.some(m=>m.id==='gpt-6-astra'&&m.freshness==='archived'));
    await restoreFrontier('openai',original.revisionId!,db); await assert.rejects(syncFrontier('openai',db,fixtureFetch(replacement)),/paused/);
    assert.equal((await frontierHealth(db)).providers.find(p=>p.provider==='openai')!.revisionId,original.revisionId);
    await db.execute(sql`update frontier_states set paused=false where provider='openai'`);
    let release!:()=>void; let started!:()=>void; const gate=new Promise<void>(r=>{release=r}); const entered=new Promise<void>(r=>{started=r});let first=true;
    const slow=(async(input,init)=>{if(first){first=false;started();await gate;}return fixtureFetch()(input,init);}) as typeof fetch;
    const ongoing=syncFrontier('openai',db,slow); await entered;
    assert.equal((await syncFrontier('openai',db,fixtureFetch())).status,'unchanged');release();await ongoing;
    await db.execute(sql`update frontier_revisions set verified_at=now()-interval '7 hours' where provider='openai'`);
    assert.equal((await frontierHealth(db)).providers.find(p=>p.provider==='openai')!.status,'stale');
    assert.ok((await readFrontier('',db)).current.some(m=>m.provider==='openai'&&m.freshness==='stale'));
  } finally { await pool.end(); }
});

test("isolated PostgreSQL: the GPT-6.2 launch replaces the profile once and a second run changes nothing", {skip:!testUrl}, async () => {
  const pool=new Pool({connectionString:testUrl,max:5}); const db=drizzle(pool,{schema}) as Database;
  const openai=async()=>(await frontierHealth(db)).providers.find(p=>p.provider==="openai")!;
  try {
    await db.execute(sql`drop table if exists frontier_states, frontier_revisions, frontier_documents cascade`);
    await migrateFrontier(db);
    await syncFrontier("openai",db,fixtureFetch()); // GPT-6 Astra, accepted before the launch
    assert.equal((await openai()).modelId,"gpt-6-astra");
    await syncFrontier("openai",db,fixtureFetch(launch));
    const first=await openai(); assert.equal(first.modelId,"gpt-6.2-astra"); assert.equal(first.status,"current");
    await syncFrontier("openai",db,fixtureFetch(launch));
    const second=await openai(); assert.equal(second.revisionId,first.revisionId); assert.equal(second.status,"current");
    const revisions=await db.execute<{model_id:string;n:number}>(sql`select model_id, count(*)::int as n from frontier_revisions where provider='openai' group by model_id order by model_id`);
    assert.deepEqual(revisions.rows,[{model_id:"gpt-6-astra",n:1},{model_id:"gpt-6.2-astra",n:1}]);
    const read=await readFrontier("gpt-6-astra",db);
    assert.equal(read.current.find(m=>m.provider==="openai")!.name,"GPT-6.2 Astra");
    assert.equal(read.available.find(m=>m.id==="gpt-6-astra")!.freshness,"archived"); // the earlier pick stays readable
  } finally { await pool.end(); }
});
