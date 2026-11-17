// Turn each publisher's data into one row shape. Parsing is strict: a missing
// file or column, or a score outside its range, fails the whole source so the
// last good snapshot stays in place.

import { z } from "zod";
import { parseCsv, unzipFiles } from "./archive";
import { isBenchmarkKey, type BenchmarkKey } from "./registry";

/** Reasoning-effort names the tracked labs and evaluators use. A closed list. */
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const benchmarkRowSchema = z.object({
  benchmark: z.string().refine(isBenchmarkKey),
  /** The model's label exactly as the publisher wrote it. */
  label: z.string().min(1).max(200),
  /** The model part of the label, before any effort or harness marker. */
  model: z.string().min(1).max(200),
  effort: z.enum(EFFORTS).nullable(),
  /** "standard", "provider-adapter" or a harness name; null when the feed has none. */
  harness: z.string().max(60).nullable(),
  /** Percent benchmarks are stored as 0–100. */
  score: z.number().finite(),
  low: z.number().finite().nullable(),
  high: z.number().finite().nullable(),
  /**
   * ci90 / ci95: a confidence interval at that level. range: best and worst of
   * repeated runs. margin: a ± figure the publisher shows without defining it.
   * Only a confidence interval can support a claim that one model leads another.
   */
  interval: z.enum(["ci90", "ci95", "range", "margin"]).nullable(),
  organization: z.string().max(120),
  /** Model release date as the feed gives it (YYYY-MM-DD), when it does. */
  released: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  note: z.string().max(300).nullable(),
  /** Page where this row can be checked. */
  url: z.string().url().nullable(),
}).strict();
export type BenchmarkRow = z.infer<typeof benchmarkRowSchema> & { benchmark: BenchmarkKey };

const TRACKED_LABS = /\b(?:OpenAI|Anthropic|Google)\b/;
/** Set on a row whose data feed marks the reasoning effort as unknown. The
 *  original leaderboard may state it; the mirrored data does not carry it. */
export const EFFORT_NOT_STATED = "Reasoning effort not recorded in the data feed";
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
function number(raw: string | undefined, what: string): number {
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${what} is not a number`);
  return value;
}
const optional = (raw: string | undefined): number | null => (raw === undefined || raw.trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw));
const date = (raw: string | undefined): string | null => (raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null);

/** Epoch writes `<model>_<effort>`; anything else after the underscore is not an effort. */
export function splitEpochLabel(label: string): { model: string; effort: Effort | null; stated: boolean } {
  const at = label.lastIndexOf("_");
  if (at <= 0) return { model: label, effort: null, stated: false };
  const suffix = label.slice(at + 1);
  if (suffix === "unknown") return { model: label.slice(0, at), effort: null, stated: true };
  return (EFFORTS as readonly string[]).includes(suffix) ? { model: label.slice(0, at), effort: suffix as Effort, stated: true } : { model: label, effort: null, stated: false };
}

interface EpochFile {
  benchmark: BenchmarkKey;
  score: string;
  /** Multiply the published score by this to store it (fractions become percent). */
  scale: number;
  min: number; max: number;
  /** Minimum rows expected; fewer means the file changed shape. */
  floor: number;
  /**
   * A proportion of this many questions, with the publisher's standard error in
   * the named column. The interval shown is a 95% Wilson interval on the score:
   * the usual "1.96 standard errors" collapses to nothing at 0% or 100% and
   * understates the upper bound for small counts.
   */
  proportion?: { trials: number; stderr: string };
  /** A published ± whose meaning the publisher does not state. */
  margin?: { column: string; scale: number };
  range?: { low: string; high: string };
  harness?: string;
  url: string;
}
const EPOCH_PAGE = "https://epoch.ai/benchmarks";
export const EPOCH_FILES: Record<string, EpochFile> = {
  "frontierswe_external.csv": { benchmark: "frontierswe", score: "Score", scale: 100, min: 0, max: 100, floor: 10, range: { low: "Worst@5", high: "Best@5" }, harness: "Harness", url: `${EPOCH_PAGE}/frontierswe` },
  "apex_agents_external.csv": { benchmark: "apex_agents", score: "Pass@1 score", scale: 100, min: 0, max: 100, floor: 20, margin: { column: "Pass@1 Standard Error", scale: 1 }, url: `${EPOCH_PAGE}/apex-agents` },
  "critpt_external.csv": { benchmark: "critpt", score: "Accuracy", scale: 100, min: 0, max: 100, floor: 50, url: `${EPOCH_PAGE}/critpt` },
  "vending_bench_2_external.csv": { benchmark: "vending_bench_2", score: "Score", scale: 1, min: -1e6, max: 1e7, floor: 20, url: `${EPOCH_PAGE}/vending-bench-2` },
  "gpqa_diamond.csv": { benchmark: "gpqa_diamond", score: "Best score (across scorers)", scale: 100, min: 0, max: 100, floor: 50, proportion: { trials: 198, stderr: "stderr" }, url: `${EPOCH_PAGE}/gpqa-diamond` },
  "frontiermath_erdos.csv": { benchmark: "frontiermath_erdos", score: "mean_score", scale: 100, min: 0, max: 100, floor: 5, proportion: { trials: 68, stderr: "stderr" }, url: `${EPOCH_PAGE}/frontiermath-erdos` },
};
const ECI_FILE = "epoch_capabilities_index/eci_scores.csv";
/** States the confidence level of the interval columns in the scores file. */
const ECI_BOOTSTRAPS = "epoch_capabilities_index/eci_bootstraps.json";
export const EPOCH_ARCHIVE_FILES = [ECI_FILE, ECI_BOOTSTRAPS, ...Object.keys(EPOCH_FILES)];

/** 95% Wilson score interval for a proportion, in percent. */
export function wilsonInterval(fraction: number, trials: number): { low: number; high: number } {
  const z = 1.96, z2 = z * z, denominator = 1 + z2 / trials;
  const centre = (fraction + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((fraction * (1 - fraction)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, centre - half) * 100, high: Math.min(1, centre + half) * 100 };
}

function need(row: Record<string, string>, column: string, file: string): string {
  if (!(column in row)) throw new Error(`${file} has no "${column}" column`);
  return row[column];
}

/** Rows for the tracked labs from Epoch AI's benchmark archive. */
export function parseEpochArchive(archive: Uint8Array): BenchmarkRow[] {
  const files = unzipFiles(archive, EPOCH_ARCHIVE_FILES);
  const rows: BenchmarkRow[] = [];

  const eci = parseCsv(files.get(ECI_FILE)!);
  if (eci.length < 100) throw new Error(`${ECI_FILE} has only ${eci.length} rows`);
  // The scores file gives an interval without its level; the bootstrap file
  // states it (0.9 when this was written). Read only the header of that file.
  const level = files.get(ECI_BOOTSTRAPS)!.slice(0, 2000).match(/"ci_level"\s*:\s*(0\.\d+)/)?.[1];
  const eciInterval: BenchmarkRow["interval"] = level === "0.9" ? "ci90" : level === "0.95" ? "ci95" : null;
  if (level === undefined) throw new Error(`${ECI_BOOTSTRAPS} does not state the interval's confidence level`);
  for (const row of eci) {
    const organization = need(row, "Organization", ECI_FILE);
    if (!TRACKED_LABS.test(organization)) continue;
    const label = need(row, "Model", ECI_FILE), score = number(need(row, "eci", ECI_FILE), `${ECI_FILE} eci for ${label}`);
    const low = optional(need(row, "eci_ci_low", ECI_FILE)), high = optional(need(row, "eci_ci_high", ECI_FILE));
    if (score < 0 || score > 1000) throw new Error(`${ECI_FILE} score out of range for ${label}`);
    const interval = eciInterval !== null && low !== null && high !== null && low <= score && score <= high;
    rows.push({ benchmark: "eci", label, model: label, effort: null, harness: null, score: round(score, 2), low: interval ? round(low, 2) : null, high: interval ? round(high, 2) : null, interval: interval ? eciInterval : null, organization, released: date(row.date), note: null, url: "https://epoch.ai/eci" });
  }

  for (const [name, spec] of Object.entries(EPOCH_FILES)) {
    const parsed = parseCsv(files.get(name)!);
    if (parsed.length < spec.floor) throw new Error(`${name} has only ${parsed.length} rows`);
    for (const row of parsed) {
      const organization = need(row, "Organization", name);
      if (!TRACKED_LABS.test(organization)) continue;
      const label = need(row, "Model version", name);
      const raw = need(row, spec.score, name);
      if (raw.trim() === "") continue; // listed, not yet scored
      const score = number(raw, `${name} ${spec.score} for ${label}`) * spec.scale;
      if (score < spec.min || score > spec.max) throw new Error(`${name} score out of range for ${label}`);
      const { model, effort, stated } = splitEpochLabel(label);
      let low: number | null = null, high: number | null = null, interval: BenchmarkRow["interval"] = null;
      if (spec.proportion) {
        const fraction = score / 100, stderr = optional(need(row, spec.proportion.stderr, name));
        // Use the interval only when the published standard error agrees that
        // this is one pass over `trials` questions. A larger one means more
        // variance than a simple proportion has, and ours would be too narrow.
        const binomial = Math.sqrt((fraction * (1 - fraction)) / spec.proportion.trials);
        if (stderr !== null && stderr >= 0 && stderr <= binomial * 1.25 + 1e-9) {
          const wilson = wilsonInterval(fraction, spec.proportion.trials);
          low = wilson.low; high = wilson.high; interval = "ci95";
        }
      } else if (spec.margin) {
        // Epoch names this column a standard error; the benchmark's own
        // leaderboard prints the same figure as a bare "±". Keep it exactly as
        // published: no clamping, so the page can print the same number back.
        const margin = optional(need(row, spec.margin.column, name));
        if (margin !== null && margin >= 0) { low = score - margin * spec.margin.scale; high = score + margin * spec.margin.scale; interval = "margin"; }
      } else if (spec.range) {
        const worst = optional(need(row, spec.range.low, name)), best = optional(need(row, spec.range.high, name));
        if (worst !== null && best !== null && worst * spec.scale <= score && score <= best * spec.scale) { low = worst * spec.scale; high = best * spec.scale; interval = "range"; }
      }
      rows.push({
        benchmark: spec.benchmark, label, model, effort, harness: spec.harness ? need(row, spec.harness, name).trim() || null : null,
        score: round(score), low: low === null ? null : round(low), high: high === null ? null : round(high), interval,
        organization, released: date(row["Release date"]), note: stated && effort === null ? EFFORT_NOT_STATED : null, url: spec.url,
      });
    }
  }
  return validated(rows, 150);
}

const arcEvaluation = z.object({ datasetId: z.string(), modelId: z.string(), score: z.number().nullable().optional(), resultsUrl: z.string().nullable().optional() }).passthrough();
const arcModel = z.object({ id: z.string(), displayName: z.string(), providerId: z.string().nullable().optional(), modelGroup: z.string().nullable().optional(), modelReleaseDate: z.string().nullable().optional(), notes: z.string().nullable().optional() }).passthrough();
const ARC_DATASETS: Record<string, BenchmarkKey> = { v3_Semi_Private: "arc_agi_3", v2_Semi_Private: "arc_agi_2" };
const ARC_LAB_PREFIX = /^(?:openai|anthropic|google)-/;

/** Rows for the tracked labs from the ARC Prize leaderboard data. */
export function parseArcPrize(evaluationsJson: string, modelsJson: string): BenchmarkRow[] {
  const evaluations = z.array(arcEvaluation).parse(JSON.parse(evaluationsJson));
  const models = new Map(z.array(arcModel).parse(JSON.parse(modelsJson)).map((m) => [m.id, m]));
  const rows: BenchmarkRow[] = [];
  for (const evaluation of evaluations) {
    const benchmark = ARC_DATASETS[evaluation.datasetId];
    if (!benchmark || typeof evaluation.score !== "number") continue;
    const meta = models.get(evaluation.modelId);
    if (!meta) throw new Error(`ARC Prize evaluation names an unknown model: ${evaluation.modelId.slice(0, 80)}`);
    const organization = meta.providerId ?? "";
    if (!TRACKED_LABS.test(organization)) continue;
    if (evaluation.score < 0 || evaluation.score > 1.0001) throw new Error(`ARC Prize score out of range for ${meta.id.slice(0, 80)}`);
    const notes = meta.notes ?? "";
    // The harness is part of the result's identity: provider-adapter runs score
    // far higher than standard-harness runs of the same model and effort.
    const adapter = /-provider-adapter$/.test(meta.id) || /provider adapter harness/i.test(notes);
    // The notes usually state the effort. Some rows have no notes, or word it
    // differently, and then the name's own "(High)" suffix is the record of it.
    const stated = notes.match(/'([a-z]+)' (?:reasoning|output) effort/)?.[1] ?? meta.displayName.match(/\(([A-Za-z]+)\)\s*$/)?.[1]?.toLowerCase();
    const effort = stated && (EFFORTS as readonly string[]).includes(stated) ? (stated as Effort) : null;
    // modelGroup is the model without its effort suffix; without it the row cannot be attributed.
    const group = (meta.modelGroup ?? "").replace(/-provider-adapter$/, "");
    if (!group || !ARC_LAB_PREFIX.test(group)) continue;
    const partial = /Partial dataset coverage/i.test(notes);
    rows.push({
      benchmark, label: meta.displayName, model: group.replace(ARC_LAB_PREFIX, ""), effort, harness: adapter ? "provider-adapter" : "standard",
      score: round(Math.min(evaluation.score, 1) * 100), low: null, high: null, interval: null, organization,
      released: date(meta.modelReleaseDate ?? undefined), note: partial ? "Partial dataset coverage; scored against the full task set" : null,
      url: evaluation.resultsUrl && /^\/results\/[a-z0-9.-]+$/.test(evaluation.resultsUrl) ? `https://arcprize.org${evaluation.resultsUrl}` : "https://arcprize.org/leaderboard",
    });
  }
  return validated(rows, 60);
}

function validated(rows: BenchmarkRow[], floor: number): BenchmarkRow[] {
  if (rows.length < floor) throw new Error(`Only ${rows.length} benchmark rows for the tracked labs (expected at least ${floor})`);
  const checked = z.array(benchmarkRowSchema).parse(rows) as BenchmarkRow[];
  // A stable order makes the content hash depend on the data, not on file order.
  return checked.sort((a, b) => a.benchmark.localeCompare(b.benchmark) || a.label.localeCompare(b.label) || (a.harness ?? "").localeCompare(b.harness ?? "") || a.score - b.score);
}
