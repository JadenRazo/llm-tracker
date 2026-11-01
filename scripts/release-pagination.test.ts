import assert from "node:assert/strict";
import { runOpenaiCodexReleases } from "../src/lib/sources/openai/openai_codex_releases";
import { resetDatabase, state } from "./fixtures/release-database";

type Mode = "normal" | "http" | "oversized" | "malformed" | "schema" | "network";
let mode: Mode = "normal";
let failurePage = 2;
let count = 20;
let calls: number[] = [];
const release = (i: number) => ({ id: i, tag_name: `v${i}`, name: `Release ${i}`, body: null,
  html_url: `https://github.com/openai/codex/releases/tag/v${i}`, draft: i === 3, prerelease: i === 4,
  published_at: "2026-11-01T10:00:00Z", created_at: "2026-11-01T09:00:00Z" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin + url.pathname, "https://api.github.com/repos/openai/codex/releases");
  const page = Number(url.searchParams.get("page") ?? "1");
  const size = Number(url.searchParams.get("per_page"));
  calls.push(page);
  // The old twenty-release request exceeds the existing body cap. No network.
  if (size === 20) return new Response("x".repeat(10 * 1024 * 1024 + 1));
  assert.equal(size, 5);
  assert.ok(page >= 1 && page <= 4);
  assert.equal(new Headers(init?.headers).get("authorization"), null);
  if (page === failurePage) {
    if (mode === "http") return new Response("unretained provider error", { status: 503 });
    if (mode === "network") throw new Error("fixture transport interruption");
    if (mode === "oversized") return new Response("x".repeat(10 * 1024 * 1024 + 1));
    if (mode === "malformed") return new Response("not json");
    if (mode === "schema") return Response.json([{ id: 1 }]);
  }
  const etag = `"page-${page}"`;
  if (new Headers(init?.headers).get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  const rows = Array.from({ length: Math.max(0, Math.min(size, count - (page - 1) * size)) }, (_, n) => release((page - 1) * size + n));
  return Response.json(rows, { headers: { etag } });
};
function reset() { resetDatabase(); mode = "normal"; failurePage = 2; count = 20; calls = []; }
async function main() {
  reset();
  const first = await runOpenaiCodexReleases();
  assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.equal(first.inserted, 19); assert.equal(first.skipped, 1); assert.equal(first.etag, '"page-1"');
  assert.equal(state.writes.length, 1);
  assert.ok(state.writes[0].every(r => r.bodyMd === null && r.provider === "openai"));
  assert.equal(state.writes[0].find(r => r.externalId === "openai/codex:v4")?.type, "prerelease");

  for (const failure of ["http", "oversized", "malformed", "schema", "network"] as Mode[]) {
    reset(); mode = failure;
    await assert.rejects(runOpenaiCodexReleases());
    assert.equal(state.writes.length, 0, `${failure}: partial write`);
    assert.deepEqual(calls, [1, 2], `${failure}: unexpected retry or extra page`);
    mode = "normal"; calls = [];
    const recovered = await runOpenaiCodexReleases();
    assert.equal(recovered.inserted, 19, `${failure}: warm cache lost uncommitted first page`);
    assert.deepEqual(calls, [1, 2, 3, 4]);
  }
  reset(); state.writeFailure = true;
  await assert.rejects(runOpenaiCodexReleases(), /fixture write failure/);
  state.writeFailure = false; calls = [];
  assert.equal((await runOpenaiCodexReleases()).inserted, 19);
  assert.deepEqual(calls, [1, 2, 3, 4]);
  // Only the runner's successfully recorded parent result can enable 304.
  state.persistedEtag = '"page-1"'; calls = [];
  assert.equal((await runOpenaiCodexReleases()).status, "unchanged");
  assert.deepEqual(calls, [1]);

  reset(); count = 0;
  assert.equal((await runOpenaiCodexReleases()).status, "ok");
  assert.deepEqual(calls, [1]); assert.equal(state.writes.length, 0);
  reset(); count = 7;
  assert.equal((await runOpenaiCodexReleases()).inserted, 6);
  assert.deepEqual(calls, [1, 2]);
  reset();
  const concurrent = await Promise.all([runOpenaiCodexReleases(), runOpenaiCodexReleases()]);
  assert.equal(concurrent.reduce((n,r) => n+r.inserted,0),19);
  assert.equal(state.stored.size,19);
  console.log("PASS: bounded 20-release pagination, body cap, no fetch retries, drafts/prereleases, all-or-nothing reads, warm retry after fetch/write failure, persisted ETag, empty/short pages and duplicate delivery.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
