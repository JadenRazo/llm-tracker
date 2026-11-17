// Benchmark comparison: real published data in, and only claims the data supports out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db";
import { parseCsv, unzipFiles } from "@/lib/benchmarks/archive";
import { EFFORT_NOT_STATED, EPOCH_ARCHIVE_FILES, parseArcPrize, parseEpochArchive, splitEpochLabel, wilsonInterval, type BenchmarkRow } from "@/lib/benchmarks/feeds";
import { canonicalModelKey, modelMatcher } from "@/lib/benchmarks/identity";
import { benchmarkCell, compareBenchmark, comparison, coverage, formatInterval, formatScore, resultsByModel, type ComparedModel } from "@/lib/benchmarks/compare";
import { BENCHMARKS, DEFAULT_BENCHMARKS, benchmark } from "@/lib/benchmarks/registry";
import { REPORTED_SCORES } from "@/lib/benchmarks/provider-reported";
import { MAX_COMPARED, compareHref, launchSiblings, requestedIds } from "@/lib/benchmarks/selection";
import { migrateBenchmarks } from "@/lib/benchmarks/migration";
import { BENCHMARK_PARSER_VERSION, BENCHMARK_URLS, rowsHash, syncBenchmarks } from "@/lib/benchmarks/sync";
import { benchmarkHealth, readBenchmarks } from "@/lib/benchmarks/read";
import { SOURCE_REGISTRY } from "@/lib/sources/registry";

const archive = new Uint8Array(readFileSync("scripts/fixtures/benchmarks/epoch-2026-11-17.zip"));
const arc = JSON.parse(readFileSync("scripts/fixtures/benchmarks/arcprize-2026-11-17.json", "utf8")) as { evaluations: unknown[]; models: unknown[] };
const arcEvaluations = JSON.stringify(arc.evaluations), arcModels = JSON.stringify(arc.models);
const epochRows = parseEpochArchive(archive), arcRows = parseArcPrize(arcEvaluations, arcModels);
const rows = [...epochRows, ...arcRows];

// The models a comparison is asked about, as the catalog names them.
const tracked: ComparedModel[] = [
  { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", provider: "openai" }, { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", provider: "openai" },
  { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "openai" }, { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai" },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", provider: "openai" }, { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", provider: "openai" },
  { id: "text-embedding-3-large", name: "text-embedding-3-large", provider: "openai" },
  { id: "claude-fable-5-2", name: "Claude Fable 5.2", provider: "claude" }, { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude" }, { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "claude" },
  { id: "claude-fable-5", name: "Claude Fable 5", provider: "claude" }, { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude" }, { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "claude" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai" },
  { id: "gemini-4-carbon", name: "Gemini 4 Carbon", provider: "gemini" }, { id: "gemini-4-argon", name: "Gemini 4 Argon", provider: "gemini" },
];
const model = (id: string) => tracked.find((m) => m.id === id)!;
const byModel = resultsByModel(rows, tracked);
const row = (key: Parameters<typeof benchmark>[0], ...ids: string[]) => compareBenchmark(key, ids.map(model), byModel);

test("the archive reader extracts only what is asked for and refuses what it cannot vouch for", () => {
  const files = unzipFiles(archive, ["README.md", "frontierswe_external.csv"]);
  assert.deepEqual([...files.keys()].sort(), ["README.md", "frontierswe_external.csv"]);
  assert.match(files.get("README.md")!, /Creative Commons Attribution/);
  assert.throws(() => unzipFiles(archive, ["not-in-the-archive.csv"]), /missing/);
  assert.throws(() => unzipFiles(archive.subarray(0, archive.length - 30), ["README.md"]), /ZIP/);
  assert.throws(() => unzipFiles(new Uint8Array(64), ["README.md"]), /no ZIP directory/);
  // One flipped byte in the middle of the compressed data is caught, not parsed.
  const corrupted = new Uint8Array(archive); corrupted[Math.floor(corrupted.length / 2)] ^= 0x55;
  assert.throws(() => unzipFiles(corrupted, EPOCH_ARCHIVE_FILES), /checksum|length|ZIP|invalid|incorrect|unexpected|too far|unknown/i);
  // A stored (uncompressed) entry and a deflated one, written by hand.
  const entry = (name: string, body: Buffer, method: 0 | 8) => {
    const data = method ? deflateRawSync(body) : body, local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26); local.write(name, 30);
    return { name, method, data, local, body, size: body.length };
  };
  const entries = [entry("a.csv", Buffer.from("x,y\n1,2\n"), 0), entry("b.csv", Buffer.from("x,y\n3,4\n".repeat(50)), 8)];
  const parts: Buffer[] = []; const directory: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const central = Buffer.alloc(46 + e.name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(e.method, 10); central.writeUInt32LE(crc32(e.body), 16); central.writeUInt32LE(e.data.length, 20); central.writeUInt32LE(e.size, 24); central.writeUInt16LE(e.name.length, 28); central.writeUInt32LE(offset, 42); central.write(e.name, 46);
    directory.push(central); parts.push(e.local, e.data); offset += e.local.length + e.data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(Buffer.concat(directory).length, 12); end.writeUInt32LE(offset, 16);
  const made = unzipFiles(Buffer.concat([...parts, ...directory, end]), ["a.csv", "b.csv"]);
  assert.equal(made.get("a.csv"), "x,y\n1,2\n"); assert.equal(parseCsv(made.get("b.csv")!).length, 99); // one header, then 99 more lines
});

test("CSV keeps quoted commas, quotes and line breaks, and rejects ragged rows", () => {
  assert.deepEqual(parseCsv('﻿name,notes,score\r\n"Model, A","said ""hi""\nthen left",1.5\nB,,2\n'), [{ name: "Model, A", notes: 'said "hi"\nthen left', score: "1.5" }, { name: "B", notes: "", score: "2" }]);
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), /row 2 has 3 fields/);
  assert.throws(() => parseCsv('a,b\n"open,2\n'), /quoted field/);
  assert.throws(() => parseCsv("a,a\n1,2\n"), /repeats a column/);
});

test("Epoch rows carry the published score, interval and settings", () => {
  const find = (key: string, label: string) => epochRows.find((r) => r.benchmark === key && r.label === label)!;
  assert.deepEqual((({ score, low, high, interval, effort }) => ({ score, low, high, interval, effort }))(find("eci", "GPT-6.2 Astra")), { score: 174.17, low: 170.29, high: 178.58, interval: "ci90", effort: null }); // Epoch's bootstrap file states ci_level 0.9
  const swe = find("frontierswe", "claude-fable-5-2_max");
  assert.deepEqual([swe.score, swe.low, swe.high, swe.interval, swe.effort, swe.harness], [69.9402, 62.05, 79.19, "range", "max", "proximus"]);
  const apex = find("apex_agents", "gemini-4-carbon_unknown"); // published as 84.2% ± 4.3%, with the ± undefined
  assert.deepEqual([apex.score, apex.low, apex.high, apex.interval, apex.effort, apex.note], [84.2, 79.9, 88.5, "margin", null, EFFORT_NOT_STATED]);
  assert.equal(find("vending_bench_2", "gemini-4-carbon_unknown").score, 16484.2067);
  // Proportions get a Wilson interval, which stays honest at the edges.
  const gpqa = find("gpqa_diamond", "gpt-6.2-astra_max");
  assert.deepEqual([gpqa.score, gpqa.low, gpqa.high, gpqa.interval, gpqa.effort], [96.8434, 93.3803, 98.5235, "ci95", "max"]);
  const zero = find("frontiermath_erdos", "claude-fable-5_max"); // 0 of 68 solved, published standard error 0
  assert.deepEqual([zero.score, zero.low, zero.high, zero.interval], [0, 0, 5.3473, "ci95"]);
  assert.ok(!epochRows.some((r) => r.low !== null && r.low === r.high)); // never a zero-width interval
  const wilson = wilsonInterval(7 / 68, 68); assert.ok(Math.abs(wilson.low - 5.07) < 0.05 && Math.abs(wilson.high - 19.8) < 0.1);
  assert.deepEqual(wilsonInterval(1, 198).high, 100);
  assert.equal(find("critpt", "claude-fable-5-2_xhigh").score, 35.7143);
  assert.ok(epochRows.every((r) => /OpenAI|Anthropic|Google/.test(r.organization))); // other labs are not tracked
  assert.ok(!epochRows.some((r) => r.benchmark === "arc_agi_2")); // ARC comes from its own publisher
  assert.deepEqual(splitEpochLabel("gpt-5.1-codex-max_xhigh"), { model: "gpt-5.1-codex-max", effort: "xhigh", stated: true });
  assert.deepEqual(splitEpochLabel("gpt-5.1-codex-max"), { model: "gpt-5.1-codex-max", effort: null, stated: false }); // "max" is part of the name
  assert.deepEqual(splitEpochLabel("claude-3-7-sonnet-20250219_16K"), { model: "claude-3-7-sonnet-20250219_16K", effort: null, stated: false }); // a thinking budget is not an effort
  assert.deepEqual(splitEpochLabel("gpt-6-astra_promax"), { model: "gpt-6-astra_promax", effort: null, stated: false });
});

test("ARC Prize rows keep harness, effort and coverage notes apart", () => {
  const astra = arcRows.filter((r) => r.benchmark === "arc_agi_3" && r.model === "gpt-6-2-astra");
  assert.equal(astra.length, 10);
  assert.deepEqual(astra.filter((r) => r.harness === "standard").map((r) => [r.effort, r.score]).sort(), [["high", 57.9969], ["low", 38.7346], ["max", 70.3061], ["medium", 44.0042], ["xhigh", 56.5133]]);
  assert.equal(astra.find((r) => r.harness === "provider-adapter" && r.effort === "xhigh")!.score, 100);
  // Rows whose notes are missing or worded differently still get their effort, from the name.
  const olderSol = arcRows.filter((r) => r.benchmark === "arc_agi_2" && r.model === "gpt-5-6-sol" && r.harness === "standard");
  assert.ok(olderSol.length >= 4); assert.equal(new Set(olderSol.map((r) => r.effort)).size, olderSol.length); assert.ok(olderSol.every((r) => r.effort !== null));
  assert.ok(arcRows.filter((r) => r.effort === null).length <= 1);
  const sol = arcRows.find((r) => r.benchmark === "arc_agi_3" && r.model === "gpt-6-2-sol" && r.effort === "max" && r.harness === "standard")!;
  assert.deepEqual([sol.score, sol.note, sol.url], [54.9267, "Partial dataset coverage; scored against the full task set", "https://arcprize.org/results/openai-gpt-6-2-sol"]);
  assert.ok(!arcRows.some((r) => r.benchmark !== "arc_agi_3" && r.benchmark !== "arc_agi_2")); // ARC-AGI-1 rows are ignored
  assert.throws(() => parseArcPrize(JSON.stringify([{ datasetId: "v3_Semi_Private", modelId: "ghost", score: 0.5 }]), "[]"), /unknown model/);
  assert.throws(() => parseArcPrize("{}", arcModels));
  // The index's interval level comes from the archive, never from an assumption.
  const files = unzipFiles(archive, EPOCH_ARCHIVE_FILES);
  assert.match(files.get("epoch_capabilities_index/eci_bootstraps.json")!, /"ci_level": 0\.9/);
  assert.throws(() => parseArcPrize(arcEvaluations.replaceAll('"score":0.7030', '"score":7.030'), arcModels), /out of range/);
});

test("a publisher's label matches one tracked model exactly, or none", () => {
  const match = modelMatcher(tracked);
  // Regression for the GPT-6.2 launch: Astra and Sol stay two models in every spelling.
  for (const [label, id] of [["gpt-6.2-astra", "gpt-6.2-astra"], ["gpt-6-2-astra", "gpt-6.2-astra"], ["GPT-6.2 Astra", "gpt-6.2-astra"], ["gpt-6.2-sol", "gpt-6.2-sol"], ["gpt-6-2-sol", "gpt-6.2-sol"], ["GPT-6.2 Sol", "gpt-6.2-sol"], ["claude-fable-5.2", "claude-fable-5-2"], ["Claude Fable 5.2", "claude-fable-5-2"], ["gemini-4-carbon", "gemini-4-carbon"]]) assert.equal(match(label), id, label);
  assert.equal(match("GPT-6 Astra"), "gpt-6-astra"); assert.notEqual(match("GPT-6 Astra"), match("GPT-6.2 Astra")); // never the newer model
  assert.equal(match("gpt-5.1-codex-max"), "gpt-5.1-codex-max"); assert.equal(match("gpt-5.1-codex"), "gpt-5.1-codex");
  for (const label of ["GPT-6.2", "gpt-6.2-astra-2026-11-17", "claude-fable-5-2-fallback", "GPT-4o (Nov 2024)", "gpt-6-astra_promax", "astra", "", "GPT-6.2 Astra Sol"]) assert.equal(match(label), null, label);
  // Two tracked models that spell the same way: the label means neither.
  const twins = modelMatcher([{ id: "gpt-6.2-sol", name: "GPT-6.2 Sol" }, { id: "gpt-6-2-sol", name: "GPT 6 2 Sol" }]);
  assert.equal(twins("gpt-6.2-sol"), null);
  // A display name may not capture another model's ID.
  const named = modelMatcher([{ id: "gpt-6-astra", name: "GPT-6.2 Astra" }, { id: "gpt-6.2-astra", name: "Astra" }]);
  assert.equal(named("gpt-6.2-astra"), "gpt-6.2-astra");
  assert.equal(canonicalModelKey("GPT-6.2 Astra (Max)"), "gpt62astramax"); // effort is split off per feed before matching, never here
  assert.ok(byModel.get("claude-opus-4-8")?.some((r) => r.benchmark === "arc_agi_3")); // ARC Prize writes "opus-4-8"
  assert.equal(byModel.get("text-embedding-3-large"), undefined);
});

test("Astra and Sol compare like for like, and a leader needs intervals that do not overlap", () => {
  const arc3 = row("arc_agi_3", "gpt-6.2-astra", "gpt-6.2-sol");
  // Each model's best run in the standard harness, never the provider-adapter runs near 100%.
  assert.deepEqual(arc3.cells.map((c) => [c.primary!.score, c.primary!.effort, c.primary!.harness]), [[70.3061, "max", "standard"], [54.9267, "max", "standard"]]);
  assert.equal(arc3.cells[0].others.length, 9); assert.ok(arc3.cells[0].others.some((r) => r.harness === "provider-adapter" && r.score === 100));
  assert.equal(arc3.leader, null); assert.match(arc3.verdict, /no confidence interval is available/);

  // Sol scores 85.8% at high, extra-high and max on ARC-AGI-2: the highest of the tied settings is the one shown.
  assert.deepEqual(row("arc_agi_2", "gpt-6.2-astra", "gpt-6.2-sol").cells.map((c) => [c.primary!.score, c.primary!.effort]), [[95.8333, "max"], [85.8333, "max"]]);
  const eciPair = row("eci", "gpt-6.2-astra", "gpt-6.2-sol");
  assert.equal(eciPair.cells[1].primary, null); assert.equal(eciPair.leader, null); assert.match(eciPair.verdict, /no independent result for GPT-6\.2 Sol/);

  const close = row("eci", "gpt-6.2-astra", "claude-fable-5-2", "gemini-4-carbon"); // 174.17, 173.5, 169.78 with overlapping intervals
  assert.equal(close.leader, null); assert.match(close.verdict, /90% intervals overlap/);
  // Review finding: Epoch's interval is a 90% interval. A leader claim on it must say so.
  const eciLead = row("eci", "gpt-6.2-astra", "claude-sonnet-5-5"); // [170.29, 178.58] against [163.83, 169.65]
  assert.equal(eciLead.leader, 0); assert.match(eciLead.verdict, /its 90% interval does not overlap/); assert.doesNotMatch(eciLead.verdict, /95%/);
  assert.equal(formatInterval(eciLead.cells[0].primary!, "index"), "90% interval 170.29 to 178.58");
  // Review finding: 0 of 68 is not certainty. Its interval reaches 5.3%, which overlaps 5.1% to 19.8%.
  const zeroScore = row("frontiermath_erdos", "gpt-6.2-astra", "claude-fable-5");
  assert.deepEqual(zeroScore.cells.map((c) => [c.primary!.score, c.primary!.effort]), [[10.2941, "max"], [0, "max"]]);
  assert.equal(zeroScore.leader, null); assert.match(zeroScore.verdict, /95% intervals overlap/);
  // Review finding: no leader across different, or unrecorded, reasoning efforts.
  const efforts = row("gpqa_diamond", "gpt-6.2-astra", "gemini-4-carbon"); // max against high
  assert.equal(efforts.leader, null); assert.match(efforts.verdict, /different reasoning-effort settings \(max effort, high effort\)/);
  const unrecorded = row("gpqa_diamond", "claude-fable-5-2", "claude-haiku-4-5-20251001"); // 93.9% against 60.5%, and Haiku's label has no effort
  assert.deepEqual(unrecorded.cells.map((c) => c.primary!.effort), ["max", null]);
  assert.equal(unrecorded.leader, null); assert.match(unrecorded.verdict, /not recorded for every model/);
  // Same effort, intervals apart: a leader, at the stated level.
  const sameEffort = row("gpqa_diamond", "gpt-6.2-astra", "claude-fable-5"); // both max: [93.4, 98.5] against [80.3, 90.0]
  assert.equal(sameEffort.leader, 0); assert.match(sameEffort.verdict, /its 95% interval does not overlap/);
  const erdos = row("frontiermath_erdos", "gpt-6.2-astra", "gpt-6-astra");
  assert.equal(erdos.leader, null); // 10.3% vs 2.9% on 68 problems: the intervals still overlap
  const swe = row("frontierswe", "claude-fable-5-2", "gpt-6-astra"); // both at max effort, in the benchmark's one harness
  assert.equal(swe.leader, null); assert.match(swe.verdict, /not a confidence interval/);
  assert.match(row("frontierswe", "claude-fable-5-2", "gemini-4-carbon").verdict, /different reasoning-effort settings/); // max against high
  const apex = row("apex_agents", "gemini-4-carbon", "gpt-6-astra"); // 84.2 ± 4.3 against 64.7 ± 5.6: far apart, and still not a claim we can make
  assert.equal(apex.leader, null); assert.match(apex.verdict, /does not record which reasoning-effort/);
  const stated = new Map([...byModel].map(([id, list]) => [id, list.map((r) => (r.benchmark === "apex_agents" ? { ...r, effort: "max" as const, note: null } : r))]));
  const apexStated = compareBenchmark("apex_agents", [model("gemini-4-carbon"), model("gpt-6-astra")], stated);
  assert.equal(apexStated.leader, null); assert.match(apexStated.verdict, /± margin without saying what it represents/);
  assert.equal(formatInterval(apexStated.cells[0].primary!, "percent"), "± 4.3 points, as published");
  const vending = row("vending_bench_2", "gemini-4-carbon", "gpt-6-astra");
  assert.equal(vending.leader, null);
  assert.equal(row("eci", "gpt-6.2-astra").leader, null);

  // A leader, when the data does support one.
  const result = (label: string, score: number, low: number, high: number): BenchmarkRow => ({ benchmark: "gpqa_diamond", label, model: label, effort: "max", harness: null, score, low, high, interval: "ci95", organization: "OpenAI", released: null, note: null, url: null });
  const clear = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [result("a", 90, 87, 93)]], ["gpt-6.2-sol", [result("s", 80, 77, 83)]]]), []);
  assert.equal(clear.leader, 0); assert.match(clear.verdict, /GPT-6\.2 Astra leads/);
  const touching = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [result("a", 90, 83, 93)]], ["gpt-6.2-sol", [result("s", 80, 77, 83)]]]), []);
  assert.equal(touching.leader, null);
  const mixed = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [{ ...result("a", 90, 87, 93), harness: "one" }]], ["gpt-6.2-sol", [{ ...result("s", 80, 77, 83), harness: "two" }]]]), []);
  assert.equal(mixed.leader, null); assert.match(mixed.verdict, /different harnesses/);
  const levels = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [result("a", 90, 87, 93)]], ["gpt-6.2-sol", [{ ...result("s", 80, 77, 83), interval: "ci90" as const }]]]), []);
  assert.equal(levels.leader, null); assert.match(levels.verdict, /different confidence levels/);
  const noEffort = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [result("a", 90, 87, 93)]], ["gpt-6.2-sol", [{ ...result("s", 80, 77, 83), effort: null }]]]), []);
  assert.equal(noEffort.leader, null);
  const lower = compareBenchmark("gpqa_diamond", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], new Map([["gpt-6.2-astra", [result("a", 90, 87, 93)]], ["gpt-6.2-sol", [{ ...result("s", 80, 77, 83), effort: "high" as const }]]]), []);
  assert.equal(lower.leader, null);
});

test("lab-reported scores are shown beside independent ones and never ranked", () => {
  const gpqa = row("gpqa_diamond", "gpt-6.2-astra", "gpt-6.2-sol");
  assert.equal(gpqa.cells[0].primary!.kind, "independent"); assert.equal(gpqa.cells[0].primary!.score, 96.8434); // Epoch AI's run
  assert.deepEqual(gpqa.cells[0].reported.map((r) => [r.kind, r.by, r.score]), [["reported", "OpenAI", 97]]); // OpenAI's own figure
  assert.equal(gpqa.cells[1].primary, null); assert.equal(gpqa.cells[1].reported[0].score, 96);
  assert.equal(gpqa.leader, null);
  const sec = row("sec_bench_pro", "gpt-6.2-astra", "gpt-6.2-sol");
  assert.deepEqual(sec.cells.map((c) => c.reported[0].score), [86.75, 88.34]); // Sol's number is higher; it is still not a ranking
  assert.equal(sec.leader, null); assert.match(sec.verdict, /Lab-reported scores are not ranked/);
  for (const score of REPORTED_SCORES) { assert.match(score.sourceUrl, /^https:\/\//); assert.match(score.retrieved, /^\d{4}-\d{2}-\d{2}$/); assert.ok(score.settings.length > 5); assert.ok(BENCHMARKS.some((b) => b.key === score.benchmark)); }
});

test("the default set stays compact, and every benchmark says how to read it", () => {
  assert.deepEqual(DEFAULT_BENCHMARKS.map((b) => b.key), ["eci", "arc_agi_3", "frontierswe", "apex_agents"]);
  // A benchmark an independent review has found flawed is shown with that warning and is never a default.
  assert.deepEqual(BENCHMARKS.filter((b) => b.caution).map((b) => [b.key, b.default]), [["critpt", false], ["vending_bench_2", false]]);
  for (const spec of BENCHMARKS.filter((b) => b.caution)) { assert.match(spec.caution!.text, /Flawed/); assert.match(spec.caution!.url, /^https:\/\/epoch\.ai\/benchmarks\/.+\/review$/); }
  assert.deepEqual(BENCHMARKS.filter((b) => !b.effortApplies).map((b) => b.key), ["eci"]);
  for (const spec of BENCHMARKS.filter((b) => b.feed !== "reported")) assert.ok(spec.uncertainty && spec.uncertainty.length > 10, spec.key);
  for (const spec of BENCHMARKS) {
    for (const field of [spec.name, spec.version, spec.capability, spec.measures, spec.metric, spec.evaluator, spec.rationale]) assert.ok(field.length >= 2, spec.key);
    assert.ok(["higher", "lower"].includes(spec.direction)); assert.match(spec.methodologyUrl, /^https:\/\//); assert.match(spec.sourceUrl, /^https:\/\//);
  }
  const table = comparison(["gpt-6.2-astra", "text-embedding-3-large"].map(model), byModel);
  assert.equal(table.defaults.length, 4); // a model with no results is still shown, with every default row
  assert.ok(table.defaults.every((r) => r.cells[1].primary === null && r.cells[1].reported.length === 0));
  assert.ok(table.more.some((r) => r.benchmark.key === "gpqa_diamond")); assert.ok(table.more.every((r) => !r.benchmark.default));
  assert.deepEqual(comparison([model("text-embedding-3-large")], byModel).more, []);
  assert.equal(coverage("gpt-6.2-astra", byModel), 2); assert.equal(coverage("gpt-6.2-sol", byModel), 1); assert.equal(coverage("text-embedding-3-large", byModel), 0);
  assert.equal(benchmarkCell("arc_agi_3", "gpt-6.2-sol", byModel.get("gpt-6.2-sol")).primary!.harness, "standard");
  assert.deepEqual([formatScore(174.17, "index"), formatScore(173.5, "index"), formatScore(170, "index"), formatScore(70.3061, "percent"), formatScore(16484.2067, "usd")], ["174.17", "173.5", "170", "70.3%", "$16,484"]);
  assert.equal(formatInterval(row("eci", "gpt-6.2-astra").cells[0].primary!, "index"), "90% interval 170.29 to 178.58");
  assert.equal(formatInterval(row("frontierswe", "claude-fable-5-2").cells[0].primary!, "percent"), "Runs ranged 62.0% to 79.2%");
});

test("a selection is read from the URL: bounded, deduplicated, and safe", () => {
  assert.deepEqual(requestedIds("gpt-6.2-astra,gpt-6.2-sol,gpt-6.2-astra,<script>,../x,o3"), ["gpt-6.2-astra", "gpt-6.2-sol", "o3"]);
  assert.equal(requestedIds("a1,b2,c3,d4,e5,f6").length, MAX_COMPARED); assert.deepEqual(requestedIds(undefined), []); assert.deepEqual(requestedIds(""), []);
  assert.equal(compareHref(["gpt-6.2-astra", "gpt-6.2-sol"]), "/compare?models=gpt-6.2-astra,gpt-6.2-sol");
  assert.equal(compareHref([]), "/compare?models="); // an explicit empty selection, not the default
  const day = "2026-11-17T18:00:00.000Z";
  const directory = [{ id: "gpt-6.2-astra", name: "GPT-6.2 Astra", provider: "openai" as const, firstSeenAt: day }, { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", provider: "openai" as const, firstSeenAt: "2026-11-17T18:00:05.000Z" }, { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai" as const, firstSeenAt: day }, { id: "gpt-6.2-luna", name: "GPT-6.2 Luna", provider: "openai" as const, firstSeenAt: "2026-12-01T00:00:00.000Z" }, { id: "gemini-6.2-sol", name: "x", provider: "gemini" as const, firstSeenAt: day }];
  assert.deepEqual(launchSiblings(directory[0], directory).map((m) => m.id), ["gpt-6.2-sol"]);
  assert.deepEqual(launchSiblings({ id: "o3", name: "o3", provider: "openai", firstSeenAt: day }, directory), []);
});

test("benchmark sources are registered on the two-hour tier and stay out of the frontier gate", () => {
  const sources = SOURCE_REGISTRY.filter((s) => s.key.startsWith("benchmarks_"));
  assert.deepEqual(sources.map((s) => [s.key, s.tier]), [["benchmarks_epoch", 3], ["benchmarks_arcprize", 3]]);
  assert.equal(SOURCE_REGISTRY.filter((s) => s.key.startsWith("frontier_")).length, 3); // the deploy gate requires exactly three
});

test("a failed benchmark read is unavailable, never an empty result", async () => {
  assert.deepEqual(await readBenchmarks(null), { rows: [], sources: [], unavailable: true });
  const failing = { execute: async () => { throw new Error("connection refused"); } } as unknown as Database;
  assert.equal((await readBenchmarks(failing)).unavailable, true);
});

const testUrl = process.env.FRONTIER_TEST_DATABASE_URL;
function feed(overrides: Record<string, () => Response> = {}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const handler = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (overrides[url]) return overrides[url]();
    if (url === BENCHMARK_URLS.epochArchive) return new Headers(init?.headers).get("if-none-match") === '"v1"' ? new Response(null, { status: 304 }) : new Response(archive, { headers: { etag: '"v1"' } });
    if (url === BENCHMARK_URLS.arcEvaluations) return new Response(arcEvaluations);
    if (url === BENCHMARK_URLS.arcModels) return new Response(arcModels);
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch & { calls: string[] };
  handler.calls = calls; return handler;
}
test("isolated PostgreSQL: publish once, repeat unchanged, and keep the last good rows through failures", { skip: !testUrl }, async () => {
  const url = new URL(testUrl!); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.equal(url.pathname, "/frontier_test");
  const pool = new Pool({ connectionString: testUrl, max: 5 }); const db = drizzle(pool, { schema }) as Database;
  const snapshot = async (source: string) => { const [found] = await db.select({ content_hash: schema.benchmarkSnapshots.contentHash, row_count: schema.benchmarkSnapshots.rowCount, published_at: schema.benchmarkSnapshots.publishedAt, verified_at: schema.benchmarkSnapshots.verifiedAt, error: schema.benchmarkSnapshots.error }).from(schema.benchmarkSnapshots).where(sql`${schema.benchmarkSnapshots.source} = ${source}`); return found; };
  try {
    await db.execute(sql`drop table if exists benchmark_snapshots`);
    assert.equal((await syncBenchmarks("benchmarks_epoch", db, feed())).status, "skipped"); // before the deployment migration
    assert.deepEqual(await readBenchmarks(db), { rows: [], sources: [], unavailable: false }); // empty, not unavailable
    assert.deepEqual(await migrateBenchmarks(db), { ok: true, migration: "benchmarks-v1" }); await migrateBenchmarks(db);

    const fetcher = feed();
    assert.equal((await syncBenchmarks("benchmarks_epoch", db, fetcher)).status, "ok");
    assert.equal((await syncBenchmarks("benchmarks_arcprize", db, fetcher)).status, "ok");
    const first = { epoch: await snapshot("benchmarks_epoch"), arc: await snapshot("benchmarks_arcprize") };
    assert.equal(first.epoch.content_hash, rowsHash(epochRows)); assert.equal(first.arc.content_hash, rowsHash(arcRows));
    assert.equal(first.epoch.row_count, epochRows.length);

    // Second run: nothing changes but the verification time.
    assert.equal((await syncBenchmarks("benchmarks_epoch", db, fetcher)).status, "unchanged"); // the publisher answered 304
    assert.equal((await syncBenchmarks("benchmarks_arcprize", db, fetcher)).status, "unchanged"); // same rows, same hash
    const second = { epoch: await snapshot("benchmarks_epoch"), arc: await snapshot("benchmarks_arcprize") };
    for (const key of ["epoch", "arc"] as const) {
      assert.equal(second[key].content_hash, first[key].content_hash); assert.equal(second[key].row_count, first[key].row_count);
      assert.equal(second[key].published_at!.getTime(), first[key].published_at!.getTime()); assert.ok(second[key].verified_at!.getTime() >= first[key].verified_at!.getTime());
    }
    // Rows parsed by an earlier version of the parser are never kept on a 304:
    // the validator is tagged with the parser version, so the archive is fetched in full again.
    await db.execute(sql`update benchmark_snapshots set etag = '2020-01-01.0 "v1"' where source = 'benchmarks_epoch'`);
    const afterUpgrade = feed();
    assert.equal((await syncBenchmarks("benchmarks_epoch", db, afterUpgrade)).status, "unchanged"); // same rows, so nothing to republish
    assert.match((await db.select({ etag: schema.benchmarkSnapshots.etag }).from(schema.benchmarkSnapshots).where(sql`${schema.benchmarkSnapshots.source} = 'benchmarks_epoch'`))[0].etag!, new RegExp(`^${BENCHMARK_PARSER_VERSION.replaceAll(".", "\\.")} "v1"$`));
    assert.equal((await syncBenchmarks("benchmarks_epoch", db, afterUpgrade)).status, "unchanged");
    assert.equal(afterUpgrade.calls.length, 2);

    const read = await readBenchmarks(db);
    assert.equal(read.unavailable, false); assert.equal(read.rows.length, rows.length); assert.ok(read.sources.every((s) => s.status === "current"));
    const astraVsSol = compareBenchmark("arc_agi_3", [model("gpt-6.2-astra"), model("gpt-6.2-sol")], resultsByModel(read.rows, tracked));
    assert.deepEqual(astraVsSol.cells.map((c) => c.primary!.score), [70.3061, 54.9267]);
    assert.equal((await benchmarkHealth(db)).ok, true);

    // The publisher is down: recorded, reported as skipped, rows kept.
    assert.equal((await syncBenchmarks("benchmarks_arcprize", db, feed({ [BENCHMARK_URLS.arcModels]: () => new Response("busy", { status: 503 }) }))).status, "skipped");
    assert.match((await snapshot("benchmarks_arcprize")).error!, /HTTP 503/); assert.equal((await snapshot("benchmarks_arcprize")).content_hash, first.arc.content_hash);
    assert.equal((await benchmarkHealth(db)).ok, false);
    // A redirect is refused, and a document that no longer parses is an error. Rows are kept both times.
    await assert.rejects(syncBenchmarks("benchmarks_arcprize", db, feed({ [BENCHMARK_URLS.arcEvaluations]: () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }) })), /HTTP 302/);
    await assert.rejects(syncBenchmarks("benchmarks_arcprize", db, feed({ [BENCHMARK_URLS.arcEvaluations]: () => new Response('{"redesigned":true}') })));
    await assert.rejects(syncBenchmarks("benchmarks_epoch", db, feed({ [BENCHMARK_URLS.epochArchive]: () => new Response("<html>moved</html>", { headers: { etag: '"v2"' } }) })), /ZIP/);
    assert.equal((await snapshot("benchmarks_epoch")).content_hash, first.epoch.content_hash); assert.equal((await readBenchmarks(db)).rows.length, rows.length);
    assert.ok((await readBenchmarks(db)).sources.every((s) => s.status === "failed"));
    // A feed that loses most of its rows is treated as a changed format, not a retraction.
    const fewer = JSON.stringify((arc.evaluations as { modelId: string }[]).filter((e) => /gpt-6-2/.test(e.modelId)));
    await assert.rejects(syncBenchmarks("benchmarks_arcprize", db, feed({ [BENCHMARK_URLS.arcEvaluations]: () => new Response(fewer) })), /rows|shrank/);
    assert.equal((await snapshot("benchmarks_arcprize")).row_count, first.arc.row_count);
    // Recovery clears the error; a genuine change replaces the rows and moves published_at.
    await syncBenchmarks("benchmarks_arcprize", db, feed()); await syncBenchmarks("benchmarks_epoch", db, feed());
    assert.equal((await benchmarkHealth(db)).ok, true);
    const revised = arcEvaluations.replace('"score":0.7030', '"score":0.7130');
    assert.notEqual(revised, arcEvaluations);
    assert.equal((await syncBenchmarks("benchmarks_arcprize", db, feed({ [BENCHMARK_URLS.arcEvaluations]: () => new Response(revised) }))).status, "ok");
    assert.notEqual((await snapshot("benchmarks_arcprize")).content_hash, first.arc.content_hash);
  } finally { await pool.end(); }
});
