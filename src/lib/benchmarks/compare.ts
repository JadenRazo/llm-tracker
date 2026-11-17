// Decide what one comparison cell shows and whether a row may name a leader.
//
// A leader is named only when the numbers support it: every selected model has
// an independent result on the same benchmark, from the same harness, at the
// same recorded reasoning effort, with confidence intervals of one level that
// do not overlap. Anything less gets the scores and the reason no leader is named.

import { benchmark as definition, BENCHMARKS, type BenchmarkDefinition, type BenchmarkKey } from "./registry";
import { EFFORTS, EFFORT_NOT_STATED, type BenchmarkRow } from "./feeds";
import { modelMatcher, type TrackedModel } from "./identity";
import { REPORTED_SCORES, type ReportedScore } from "./provider-reported";

export interface ComparedModel extends TrackedModel { provider: "claude" | "openai" | "gemini" }

/** One published result for a tracked model. */
export interface ModelResult {
  score: number;
  low: number | null;
  high: number | null;
  interval: "ci90" | "ci95" | "range" | "margin" | null;
  effort: string | null;
  harness: string | null;
  note: string | null;
  label: string;
  url: string | null;
  kind: "independent" | "reported";
  /** Who ran or published it. */
  by: string;
  /** Stated conditions, for lab-reported results. */
  settings: string | null;
}

export interface BenchmarkCell {
  /** The independent result shown as this model's score, if any. */
  primary: ModelResult | null;
  /** Other independent configurations of the same model (other efforts or harnesses). */
  others: ModelResult[];
  /** Lab-reported results, shown separately. */
  reported: ModelResult[];
}

export interface BenchmarkComparisonRow {
  benchmark: BenchmarkDefinition;
  cells: BenchmarkCell[];
  /** Index into the selected models, when the results support naming a leader. */
  leader: number | null;
  /** Why no leader is named, or what the leader claim rests on. */
  verdict: string;
}

const ANTHROPIC = /\bAnthropic\b/;

/** Rows grouped by tracked model. Labels that match no tracked model are left out. */
export function resultsByModel(rows: readonly BenchmarkRow[], tracked: readonly TrackedModel[]): Map<string, BenchmarkRow[]> {
  const match = modelMatcher(tracked);
  const grouped = new Map<string, BenchmarkRow[]>();
  for (const row of rows) {
    // ARC Prize drops Anthropic's "claude-" prefix from some model groups.
    const id = match(row.model) ?? (ANTHROPIC.test(row.organization) && !/^claude/i.test(row.model) ? match(`claude-${row.model}`) : null);
    if (!id) continue;
    const list = grouped.get(id);
    if (list) list.push(row); else grouped.set(id, [row]);
  }
  return grouped;
}

const independent = (row: BenchmarkRow, by: string): ModelResult => ({ score: row.score, low: row.low, high: row.high, interval: row.interval, effort: row.effort, harness: row.harness, note: row.note, label: row.label, url: row.url, kind: "independent", by, settings: null });
const reported = (score: ReportedScore): ModelResult => ({ score: score.score, low: null, high: null, interval: null, effort: score.effort, harness: null, note: null, label: score.sourceTitle, url: score.sourceUrl, kind: "reported", by: score.reportedBy, settings: score.settings });

/** The harness results are comparable in: provider-adapter runs are a different test. */
const comparableHarness = (row: BenchmarkRow) => row.harness !== "provider-adapter";

export function benchmarkCell(key: BenchmarkKey, modelId: string, rows: readonly BenchmarkRow[] | undefined, reportedScores: readonly ReportedScore[] = REPORTED_SCORES): BenchmarkCell {
  const spec = definition(key);
  const mine = (rows ?? []).filter((row) => row.benchmark === key);
  // Best score first. On a tie the higher effort is shown, so two models that
  // tie across settings are not reported as run at different ones.
  const rank = (row: BenchmarkRow) => (row.effort ? EFFORTS.indexOf(row.effort) : -1);
  const better = (a: BenchmarkRow, b: BenchmarkRow) => (spec.direction === "higher" ? b.score - a.score : a.score - b.score) || rank(b) - rank(a) || (a.label < b.label ? -1 : 1);
  // The score shown is the model's best published configuration in the
  // comparable harness; its effort is displayed, and the rest are listed.
  const comparable = mine.filter(comparableHarness).sort(better);
  const rest = [...comparable.slice(1), ...mine.filter((row) => !comparableHarness(row)).sort(better)];
  return {
    primary: comparable[0] ? independent(comparable[0], spec.evaluator) : null,
    others: rest.map((row) => independent(row, spec.evaluator)),
    reported: reportedScores.filter((score) => score.benchmark === key && score.modelId === modelId).map(reported),
  };
}

export function compareBenchmark(key: BenchmarkKey, models: readonly ComparedModel[], byModel: ReadonlyMap<string, BenchmarkRow[]>, reportedScores: readonly ReportedScore[] = REPORTED_SCORES): BenchmarkComparisonRow {
  const spec = definition(key);
  const cells = models.map((model) => benchmarkCell(key, model.id, byModel.get(model.id), reportedScores));
  const named = (indexes: number[]) => indexes.map((i) => models[i].name).join(", ");
  const missing = cells.flatMap((cell, i) => (cell.primary ? [] : [i]));
  let leader: number | null = null, verdict: string;
  if (models.length < 2) verdict = "Select another model to compare.";
  else if (missing.length === models.length) verdict = cells.some((cell) => cell.reported.length) ? "Only lab-reported results exist for these models. Lab-reported scores are not ranked." : "No published result for these models.";
  else if (missing.length) verdict = `No leader named: no independent result for ${named(missing)}.`;
  else if (new Set(cells.map((cell) => cell.primary!.harness ?? "")).size > 1) verdict = "No leader named: these results come from different harnesses.";
  else if (spec.effortApplies && cells.some((cell) => cell.primary!.effort === null)) verdict = cells.some((cell) => cell.primary!.note === EFFORT_NOT_STATED)
    ? "No leader named: the data feed does not record which reasoning-effort setting was used, so the runs may not be like for like."
    : "No leader named: the reasoning-effort setting is not recorded for every model, so the runs may not be like for like.";
  else if (spec.effortApplies && new Set(cells.map((cell) => cell.primary!.effort)).size > 1) verdict = `No leader named: the models were run at different reasoning-effort settings (${[...new Set(cells.map((cell) => effortLabel(cell.primary!.effort)!.toLowerCase()))].join(", ")}).`;
  else if (!cells.every((cell) => cell.primary!.interval === "ci90" || cell.primary!.interval === "ci95")) verdict = cells.some((cell) => cell.primary!.interval === "range") ? "No leader named: the publisher reports a best-to-worst range of runs, not a confidence interval."
    : cells.some((cell) => cell.primary!.interval === "margin") ? "No leader named: the publisher shows a ± margin without saying what it represents." : "No leader named: no confidence interval is available for every model.";
  else if (new Set(cells.map((cell) => cell.primary!.interval)).size > 1) verdict = "No leader named: the intervals are at different confidence levels.";
  else {
    const order = cells.map((_, i) => i).sort((a, b) => (spec.direction === "higher" ? cells[b].primary!.score - cells[a].primary!.score : cells[a].primary!.score - cells[b].primary!.score));
    const top = cells[order[0]].primary!;
    const clear = order.slice(1).every((i) => (spec.direction === "higher" ? top.low! > cells[i].primary!.high! : top.high! < cells[i].primary!.low!));
    const level = top.interval === "ci90" ? "90%" : "95%";
    if (clear) { leader = order[0]; verdict = `${models[order[0]].name} leads: its ${level} interval does not overlap any other selected model’s.`; }
    else verdict = `No leader named: the ${level} intervals overlap, so the difference may be noise.`;
  }
  return { benchmark: spec, cells, leader, verdict };
}

/** Default benchmarks always; the rest only when a selected model has something to show. */
export function comparison(models: readonly ComparedModel[], byModel: ReadonlyMap<string, BenchmarkRow[]>, reportedScores: readonly ReportedScore[] = REPORTED_SCORES): { defaults: BenchmarkComparisonRow[]; more: BenchmarkComparisonRow[] } {
  const rows = BENCHMARKS.map((spec) => compareBenchmark(spec.key, models, byModel, reportedScores));
  const hasData = (row: BenchmarkComparisonRow) => row.cells.some((cell) => cell.primary || cell.reported.length);
  return { defaults: rows.filter((row) => row.benchmark.default), more: rows.filter((row) => !row.benchmark.default && hasData(row)) };
}

/** How many default benchmarks have an independent result for a model. */
export function coverage(modelId: string, byModel: ReadonlyMap<string, BenchmarkRow[]>): number {
  const keys = new Set((byModel.get(modelId) ?? []).filter(comparableHarness).map((row) => row.benchmark));
  return BENCHMARKS.filter((spec) => spec.default && keys.has(spec.key)).length;
}

const EFFORT_LABEL: Record<string, string> = { none: "No reasoning", minimal: "Minimal effort", low: "Low effort", medium: "Medium effort", high: "High effort", xhigh: "Extra-high effort", max: "Max effort" };
export const effortLabel = (effort: string | null): string | null => (effort ? EFFORT_LABEL[effort] ?? effort : null);
export const harnessLabel = (harness: string | null): string | null => (harness === "provider-adapter" ? "Provider-adapter harness" : harness === "standard" ? "Standard harness" : harness ? `${harness} harness` : null);

export function formatScore(value: number, unit: BenchmarkDefinition["unit"]): string {
  if (unit === "usd") return `$${Math.round(value).toLocaleString("en-US")}`;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return value.toFixed(2).replace(/\.?0+$/, ""); // 174.17, 173.5, 96.06
}
export function formatInterval(result: ModelResult, unit: BenchmarkDefinition["unit"]): string | null {
  if (result.low === null || result.high === null || !result.interval) return null;
  if (result.interval === "margin") return `± ${((result.high - result.low) / 2).toFixed(1)} points, as published`;
  const span = `${formatScore(result.low, unit)} to ${formatScore(result.high, unit)}`;
  return result.interval === "ci90" ? `90% interval ${span}` : result.interval === "ci95" ? `95% interval ${span}` : `Runs ranged ${span}`;
}
