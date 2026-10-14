import assert from "node:assert/strict";
import { test } from "node:test";
import { FRONTIER_MODELS, comparisonSelection, comparisonHref, comparisonRows, differingRows, frontierModel, modelPrice, profileNeedsReview } from "@/lib/frontier-models";
import { isUnknownPath } from "@/middleware";

test("comparison URLs round-trip, deduplicate, reject unknown IDs and keep provider order", () => {
  assert.deepEqual(comparisonSelection(null), FRONTIER_MODELS);
  assert.deepEqual(comparisonSelection(""), []);
  assert.deepEqual(comparisonSelection("not-a-model,<script>"), []);
  const ids = ["gemini-4-argon", "gpt-6-astra", "gpt-6-astra", "invalid"];
  const href = comparisonHref(ids);
  assert.equal(href, "/compare?models=gpt-6-astra,gemini-4-argon");
  assert.deepEqual(comparisonSelection(new URL(href, "https://example.com").searchParams.get("models")).map((m) => m.id), ["gpt-6-astra", "gemini-4-argon"]);
  assert.equal(frontierModel("__proto__"), undefined);
});

test("scheduled prices change on the exact published UTC date", () => {
  const argon = frontierModel("gemini-4-argon")!;
  assert.deepEqual(modelPrice(argon, "2026-11-30"), { input: 2, output: 10 });
  assert.deepEqual(modelPrice(argon, "2026-12-01"), { input: 4, output: 20 });
  const astra = frontierModel("gpt-6-astra")!;
  assert.deepEqual(modelPrice(astra, "2026-12-01"), { input: 10, output: 50 });
});

test("differences are recalculated for the selected pair, including equal prices and modalities", () => {
  const pair = comparisonSelection("claude-fable-5-1,gpt-6-astra");
  const differences = differingRows(comparisonRows(pair, "2026-10-13"));
  for (const label of ["Inputs", "Input / 1M tokens", "Output / 1M tokens", "Native output", "Maximum output"]) {
    assert.equal(differences.some((row) => row.label === label), false, label);
  }
  assert.ok(differences.some((row) => row.label === "Tradeoff"));
  assert.ok(differingRows(comparisonRows(FRONTIER_MODELS, "2026-10-13")).some((row) => row.label === "Inputs"));
  assert.deepEqual(differingRows(comparisonRows([], "2026-10-13")), []);
});

test("review age uses the editorial source date, with an exact 30-day boundary", () => {
  assert.equal(profileNeedsReview(new Date("2026-11-11T23:59:59Z")), false);
  assert.equal(profileNeedsReview(new Date("2026-11-12T00:00:00Z")), true);
});

test("new routes pass middleware while unknown profiles and nested comparison paths hard-404", () => {
  for (const path of ["/", "/compare", "/models", ...FRONTIER_MODELS.map((m) => `/models/${m.id}`)]) assert.equal(isUnknownPath(path), false, path);
  for (const path of ["/models/unknown", "/models/gpt-6-astra/nope", "/compare/nope"]) assert.equal(isUnknownPath(path), true, path);
});
