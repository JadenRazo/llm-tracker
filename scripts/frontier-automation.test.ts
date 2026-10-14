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
  assert.equal(claude.id, "claude-fable-5-1"); assert.equal(openai.id, "gpt-6-astra"); assert.equal(gemini.id, "gemini-4-argon");
  for (const facts of [claude, openai, gemini]) assert.ok(facts.inputs.includes("pdf"));
  assert.deepEqual(claude.reasoning.levels, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(openai.pricing.longContext?.above, 272000); assert.equal(openai.context.maxInput, 922000);
  assert.equal(gemini.context.kind, "shared"); assert.equal(gemini.output.tokens, 65536); assert.equal(gemini.output.extended, 1048576);
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
  const preview = cheerio.load(docs("gemini")[0].body); preview(".status-subtext").text("Preview");
  assert.throws(() => selectCandidate("gemini", preview.html()), /found 0/);
  assert.equal(parse("gemini").id, "gemini-4-argon"); // preview computer-use feature does not exclude a stable model
  assert.equal(new URL(selectCandidate("gemini", docs("gemini")[0].body).url).search, "?hl=en");
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
  const geminiSurcharge=docs("gemini");geminiSurcharge[2].body=geminiSurcharge[2].body.replace('Standard</h3>','Standard</h3><p>Prompts above 200K tokens incur a surcharge of 2x.</p>');assert.throws(()=>parse("gemini",geminiSurcharge),/pricing qualifier/);
  const nestedClaude=docs("claude");const c=cheerio.load(nestedClaude[1].body);c('dl').filter((_,el)=>c(el).find('dt').toArray().some(dt=>c(dt).text()==='Input')).append('<dt>Long-context pricing</dt><dd>Prompts above 200K tokens incur a surcharge of 2x.</dd>');nestedClaude[1].body=c.html();assert.throws(()=>parse("claude",nestedClaude),/pricing field/);
  const nestedGemini=docs("gemini");const g=cheerio.load(nestedGemini[2].body);g('section').filter((_,el)=>g(el).find('h3').first().text()==='Standard').find('table').append('<tfoot><tr><td colspan="3">Prompts above 200K tokens incur a surcharge of 2x.</td></tr></tfoot>');nestedGemini[2].body=g.html();assert.throws(()=>parse("gemini",nestedGemini),/pricing footnote/);
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
  for (const suffix of ["", "?hl=th", "?hl=en&hl=th", "?hl=en&redirect=https://evil.test"]) assert.equal(allowedDocument("gemini", geminiUrl.split("?")[0] + suffix), false);
  await assert.rejects(documentReader("gemini", memoryStore(), (async () => new Response(null, {status:302, headers:{location:geminiUrl.replace("hl=en", "hl=th")}})) as typeof fetch)(geminiUrl), /302/);
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
