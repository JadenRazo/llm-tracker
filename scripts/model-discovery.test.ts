// Regressions for the 2026-11 discovery failures: a second model from the same
// launch must be its own catalog row with its own page, and a source that stops
// reading its upstream must say so.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseModelIndex, parseModelDetail, runOpenaiModels } from "@/lib/sources/openai/openai_models";
import { runGeminiModels } from "@/lib/sources/gemini/gemini_models";
import { CATALOG_MODEL_ID, catalogPrice, officialModelPage, readCatalogModel } from "@/lib/model-directory";
import { staleSources, type SourceState } from "@/lib/source-health";
import { requestedModelIds } from "@/lib/frontier/read";
import { isUnknownPath } from "@/middleware";
import { resetDatabase, state } from "./fixtures/catalog-database";

const launch = JSON.parse(readFileSync("scripts/fixtures/frontier/openai-2026-11-17.json", "utf8")).documents as { url: string; body: string }[];
const openaiIndex = launch[0].body;
const geminiLineup = (JSON.parse(readFileSync("scripts/fixtures/frontier/documents.json", "utf8")).providers.gemini as { url: string; body: string }[])[0].body;

/** Serve one body for the index URL; anything else is a 404. Records request headers. */
function serve(index: string, body: string, etag?: string) {
  const requests: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return url === index ? new Response(body, { headers: etag ? { etag } : {} }) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  return requests;
}
const OPENAI_INDEX = "https://developers.openai.com/api/docs/models.md";
const GEMINI_INDEX = "https://aistudio.google.com/docs/models.md";
const inserted = () => state.operations.filter((o) => o.kind === "insert").flatMap((o) => o.values as { id?: string; externalId?: string; displayName?: string }[]);

test("the GPT-6.2 launch index yields Astra and Sol as two models, and no listing pages", () => {
  const parsed = parseModelIndex(openaiIndex);
  const byId = new Map(parsed.map((m) => [m.id, m.displayName]));
  assert.equal(byId.get("gpt-6.2-astra"), "GPT-6.2 Astra");
  assert.equal(byId.get("gpt-6.2-sol"), "GPT-6.2 Sol");
  assert.equal(parsed.length, byId.size);
  assert.match(openaiIndex, /\(\/api\/docs\/models\/all\.md\)/); // the link that used to become a model called "all"
  assert.ok(!byId.has("all") && !byId.has("compare"));
  assert.deepEqual(parseModelIndex("[all models](/api/docs/models/all.md) [Compare](/api/docs/models/compare.md) [GPT-9](/api/docs/models/gpt-9.md)"), [{ id: "gpt-9", displayName: "GPT-9" }]);
  const [astra, sol] = [launch[1].body, launch[3].body].map(parseModelDetail);
  assert.deepEqual([astra.pricingIn, astra.pricingOut, sol.pricingIn, sol.pricingOut], ["8.0000", "40.0000", "2.0000", "10.0000"]);
  assert.deepEqual([astra.contextWindow, sol.contextWindow, astra.maxOutput], [1050000, 1050000, 128000]);
});

test("openai_models stores both launch models, removes the bogus listing row, and tolerates a repeat insert", async () => {
  resetDatabase([[], [], []]); // no recorded validators, no existing models, nothing left to enrich
  serve(OPENAI_INDEX, openaiIndex);
  const result = await runOpenaiModels();
  assert.equal(result.status, "ok");
  const rows = inserted();
  const modelRows = rows.filter((r) => r.id !== undefined), events = rows.filter((r) => r.externalId !== undefined);
  for (const id of ["gpt-6.2-astra", "gpt-6.2-sol"]) {
    assert.equal(modelRows.filter((r) => r.id === id).length, 1, id);
    assert.equal(events.filter((r) => r.externalId === id).length, 1, id);
  }
  assert.ok(!modelRows.some((r) => r.id === "all"));
  assert.equal(state.operations.filter((o) => o.kind === "delete").length, 2); // the "all" model row and its "new model" event
  assert.equal(result.inserted, modelRows.length);
});

test("a page that parses to too few models is a failed run that writes nothing", async () => {
  resetDatabase();
  serve(OPENAI_INDEX, "# Models\n\n[GPT-9](/api/docs/models/gpt-9.md)\n");
  await assert.rejects(runOpenaiModels(), /parsed only 1 models/);
  assert.deepEqual(state.operations, []);

  resetDatabase();
  serve(GEMINI_INDEX, "<!doctype html><title>Google AI Studio</title>"); // what the moved docs answered
  await assert.rejects(runGeminiModels(), /parsed 0 model cards/);
  assert.deepEqual(state.operations, []);
});

test("a failed parse is not remembered as the current version of the page", async () => {
  resetDatabase();
  const requests = serve(GEMINI_INDEX, "<html>redesigned</html>", '"v2"');
  await assert.rejects(runGeminiModels());
  await assert.rejects(runGeminiModels()); // a warm container must fetch it again, unconditionally
  assert.equal(requests.filter((r) => r.url === GEMINI_INDEX).length, 2);
  for (const request of requests) assert.equal(request.headers.get("if-none-match"), null);

  resetDatabase([[], [], []]);
  serve(GEMINI_INDEX, geminiLineup);
  const recovered = await runGeminiModels();
  assert.equal(recovered.status, "ok");
  assert.ok(inserted().some((r) => r.id === "gemini-4-carbon") && inserted().some((r) => r.id === "gemini-4-hydrogen"));
});

test("stale means no successful read for three scheduled runs, whatever ran since", () => {
  const now = Date.parse("2026-11-17T12:00:00Z"), ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const registry = [{ key: "t1", tier: 1 }, { key: "t3_skipping", tier: 3 }, { key: "t3_fresh", tier: 3 }, { key: "t3_never", tier: 3 }, { key: "t2_late", tier: 2 }] as const;
  const rows: SourceState[] = [
    { source: "t1", status: "unchanged", startedAt: ago(5), lastGoodAt: ago(5) },
    // Ran two minutes ago, as it has every two hours for two weeks, and read nothing.
    { source: "t3_skipping", status: "skipped", startedAt: ago(2), lastGoodAt: null },
    { source: "t3_fresh", status: "skipped", startedAt: ago(2), lastGoodAt: ago(130) }, // one blip is not stale
    { source: "t2_late", status: "ok", startedAt: ago(91), lastGoodAt: ago(91) },
  ];
  assert.deepEqual(staleSources(rows, now, registry), ["t2_late", "t3_skipping"]); // never-run sources are reported separately
});

test("every catalog-shaped model path reaches the app; malformed ones hard-404", () => {
  for (const id of ["gpt-6.2-sol", "gpt-6.2-astra", "gemini-4-carbon", "claude-fable-5-2", "o3", "text-embedding-3-large", "gemini-2.5-flash-native-audio-preview-12-2025"]) {
    assert.equal(isUnknownPath(`/models/${id}`), false, id);
    assert.ok(CATALOG_MODEL_ID.test(id), id);
    assert.deepEqual(requestedModelIds(id), [id]);
  }
  for (const path of ["/models/a", "/models/-leading", "/models/Upper-Case", "/models/has space", "/models/a%2Fb", "/models/<script>", "/models/gpt-6.2-sol/extra", `/models/${"a".repeat(101)}`]) assert.equal(isUnknownPath(path), true, path);
  assert.equal(isUnknownPath("/models"), false); // the legacy redirect root
  assert.deepEqual(requestedModelIds("gpt-6.2-sol,<script>,gpt-6.2-sol,../x"), ["gpt-6.2-sol"]);
});

test("a catalog lookup separates found, not found and unavailable", async () => {
  const row = { id: "gpt-6.2-sol", displayName: "GPT-6.2 Sol", provider: "openai", contextWindow: 1050000, maxOutput: 128000, pricingIn: "2.0000", pricingOut: "10.0000", capabilities: {}, firstSeenAt: new Date(), lastSeenAt: new Date() };
  const answering = (rows: unknown[]) => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) }) as never;
  assert.equal((await readCatalogModel("gpt-6.2-sol", answering([row]))).model?.displayName, "GPT-6.2 Sol");
  assert.deepEqual(await readCatalogModel("gpt-6.2-sol", answering([])), { model: null, unavailable: false });
  assert.deepEqual(await readCatalogModel("gpt-6.2-sol", null), { model: null, unavailable: true });
  const failing = { select: () => { throw new Error("connection refused"); } } as never;
  assert.deepEqual(await readCatalogModel("gpt-6.2-sol", failing), { model: null, unavailable: true });
  assert.deepEqual(await readCatalogModel("<script>", failing), { model: null, unavailable: false }); // never queried
  assert.deepEqual(await readCatalogModel("gpt-6.2-sol", answering([{ ...row, provider: "other" }])), { model: null, unavailable: false });
  assert.deepEqual([catalogPrice("8.0000"), catalogPrice("0.4000"), catalogPrice(null), catalogPrice("n/a")], ["8", "0.4", null, null]);
  assert.equal(officialModelPage("openai", "gpt-6.2-sol").url, "https://developers.openai.com/api/docs/models/gpt-6.2-sol");
  assert.equal(officialModelPage("gemini", "gemini-4-carbon").url, "https://aistudio.google.com/docs/models/gemini-4-carbon");
});
