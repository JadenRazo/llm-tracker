import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { assertFrontierStatus } from "./assert-frontier-status.mjs";

const base = new URL(process.argv[2] ?? "https://llm.raizhost.com");
async function read(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  assert.ok(response.ok, `HTTP ${response.status}: ${path}`);
  return response.text();
}
const profiles = assertFrontierStatus(JSON.parse(await read("/api/health")));
for (const path of ["/", "/compare", ...profiles.map((p) => `/models/${p.modelId}`)]) {
  const $ = cheerio.load(await read(path));
  for (const profile of profiles.filter((p) => !path.startsWith("/models/") || path.endsWith(p.modelId))) {
    const record = $(`[data-model-id="${profile.modelId}"][data-revision="${profile.revisionId}"]`);
    assert.equal(record.length, 1, `${path}: expected the accepted database revision for ${profile.modelId}`);
    assert.equal(record.attr("data-freshness"), "current", `${path}: fallback cannot satisfy acceptance`);
  }
  console.log(`Verified ${path}`);
}
