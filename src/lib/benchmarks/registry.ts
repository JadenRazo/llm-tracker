// The benchmarks the tracker shows, and why. Everything a visitor needs to
// interpret a score lives here: what the benchmark measures, its version, the
// metric and its direction, who ran it, and where to check it.
//
// Selection criteria for the default set (see docs/benchmarks.md):
//   1. it measures something a reader can name;
//   2. its method is documented;
//   3. it covers current models from all three tracked labs;
//   4. it still separates them (not saturated);
//   5. its results are published as data, with no key or login.
// A benchmark that fails 5 cannot be refreshed by the poller and is left out.

export type BenchmarkKey =
  | "eci" | "arc_agi_3" | "frontierswe" | "apex_agents" | "critpt" | "vending_bench_2"
  | "gpqa_diamond" | "arc_agi_2" | "frontiermath_erdos" | "sec_bench_pro" | "mle_bench_revised";

export type BenchmarkUnit = "percent" | "index" | "usd";
export type BenchmarkFeed = "epoch" | "arcprize" | "reported";

export interface BenchmarkDefinition {
  key: BenchmarkKey;
  name: string;
  /** Version or subset as the publisher names it. */
  version: string;
  /** Short capability label used as the row heading. */
  capability: string;
  /** One sentence: what a higher score means the model can do. */
  measures: string;
  metric: string;
  unit: BenchmarkUnit;
  /** Every benchmark here is higher-is-better; kept explicit so the page never assumes it. */
  direction: "higher" | "lower";
  /** Who ran the evaluation for the polled results. */
  evaluator: string;
  methodologyUrl: string;
  /** Where the published results can be checked. */
  sourceUrl: string;
  feed: BenchmarkFeed;
  /** Part of the compact default comparison. */
  default: boolean;
  /** Why it is (or is not) a default, shown on the page. */
  rationale: string;
  /** Set when top models are within noise of the ceiling. */
  saturated?: string;
  /** How the published uncertainty should be read, when there is any. */
  uncertainty?: string;
}

const EPOCH = "https://epoch.ai/benchmarks";

export const BENCHMARKS: readonly BenchmarkDefinition[] = [
  {
    key: "eci", name: "Epoch Capabilities Index", version: "ECI", capability: "General capability",
    measures: "One scale built from many benchmarks, so models that were never run on the same test can still be placed relative to each other.",
    metric: "Index score", unit: "index", direction: "higher", evaluator: "Epoch AI",
    methodologyUrl: "https://epoch.ai/eci", sourceUrl: "https://epoch.ai/eci", feed: "epoch", default: true,
    rationale: "An independent composite with a published 95% interval, and the broadest coverage of current models.",
    uncertainty: "95% confidence interval published by Epoch AI.",
  },
  {
    key: "arc_agi_3", name: "ARC-AGI-3", version: "Semi-private set", capability: "Reasoning on novel tasks",
    measures: "Interactive puzzle environments the model has not seen, scored on how much of each it completes.",
    metric: "Score", unit: "percent", direction: "higher", evaluator: "ARC Prize Foundation",
    methodologyUrl: "https://arcprize.org/arc-agi/3/", sourceUrl: "https://arcprize.org/leaderboard", feed: "arcprize", default: true,
    rationale: "Run by the benchmark's own foundation on held-back tasks, per reasoning-effort setting, and far from its ceiling.",
  },
  {
    key: "frontierswe", name: "FrontierSWE", version: "v2 (September 2026)", capability: "Software engineering",
    measures: "Long software engineering tasks (implementation, performance, scientific computing, AI research) with a 20-hour budget per task, every model at maximum reasoning effort.",
    metric: "Mean score over 5 runs", unit: "percent", direction: "higher", evaluator: "FrontierSWE, mirrored by Epoch AI",
    methodologyUrl: `${EPOCH}/frontierswe`, sourceUrl: "https://www.frontierswe.com/", feed: "epoch", default: true,
    rationale: "Every model runs in the same harness, and the scores are spread widely enough to separate current models.",
    uncertainty: "The publisher reports the best and worst of 5 runs, shown as a range. A range is not a confidence interval.",
  },
  {
    key: "apex_agents", name: "APEX-Agents", version: "480 tasks", capability: "Agentic professional work",
    measures: "Multi-step professional tasks in investment banking, consulting and corporate law, in simulated work environments.",
    metric: "Pass@1", unit: "percent", direction: "higher", evaluator: "Mercor, mirrored by Epoch AI",
    methodologyUrl: `${EPOCH}/apex-agents`, sourceUrl: `${EPOCH}/apex-agents`, feed: "epoch", default: true,
    rationale: "Long-horizon knowledge work rather than coding, with a published margin for each model.",
    uncertainty: "The publisher shows a ± margin without defining it, so it is shown as published and not treated as a confidence interval.",
  },
  {
    key: "critpt", name: "CritPt", version: "v1", capability: "Research-level science",
    measures: "Open-ended physics problems modelled on entry-level original research projects.",
    metric: "Accuracy", unit: "percent", direction: "higher", evaluator: "CritPt leaderboard (Artificial Analysis), mirrored by Epoch AI",
    methodologyUrl: `${EPOCH}/critpt`, sourceUrl: `${EPOCH}/critpt`, feed: "epoch", default: true,
    rationale: "Research-level reasoning where the best models still score under 40%, reported per reasoning-effort setting.",
  },
  {
    key: "vending_bench_2", name: "Vending-Bench 2", version: "Mean of 5 runs", capability: "Long-horizon autonomy",
    measures: "Running a simulated vending business for a simulated year; the score is the money balance at the end.",
    metric: "Final balance", unit: "usd", direction: "higher", evaluator: "Andon Labs, mirrored by Epoch AI",
    methodologyUrl: `${EPOCH}/vending-bench-2`, sourceUrl: "https://andonlabs.com/evals/vending-bench-2", feed: "epoch", default: true,
    rationale: "Tests staying coherent over a very long task, and current models differ by thousands of dollars.",
  },
  {
    key: "gpqa_diamond", name: "GPQA Diamond", version: "198 questions", capability: "Graduate-level science questions",
    measures: "Multiple-choice questions in biology, chemistry and physics written by domain experts.",
    metric: "Accuracy", unit: "percent", direction: "higher", evaluator: "Epoch AI",
    methodologyUrl: `${EPOCH}/gpqa-diamond`, sourceUrl: `${EPOCH}/gpqa-diamond`, feed: "epoch", default: false,
    rationale: "Widely quoted by labs, so it is the clearest place to set a lab's own number beside an independent run.",
    saturated: "Top models are within a point or two of the estimated 97% ceiling, so small gaps mean little.",
    uncertainty: "95% interval computed here as 1.96 times the published standard error.",
  },
  {
    key: "arc_agi_2", name: "ARC-AGI-2", version: "Semi-private set", capability: "Abstract reasoning puzzles",
    measures: "Static grid puzzles that require inferring a rule from a few examples.",
    metric: "Score", unit: "percent", direction: "higher", evaluator: "ARC Prize Foundation",
    methodologyUrl: "https://arcprize.org/arc-agi/2/", sourceUrl: "https://arcprize.org/leaderboard", feed: "arcprize", default: false,
    rationale: "Still separates mid-tier models from the top, and has results for most new releases on launch day.",
    saturated: "The strongest models score within about two points of each other, near the human panel.",
  },
  {
    key: "frontiermath_erdos", name: "FrontierMath Erdős", version: "68 open problems", capability: "Open mathematics problems",
    measures: "Formal Lean proofs or disproofs of problems posed or studied by Paul Erdős that were open in August 2026.",
    metric: "Problems solved", unit: "percent", direction: "higher", evaluator: "Epoch AI",
    methodologyUrl: `${EPOCH}/frontiermath-erdos`, sourceUrl: `${EPOCH}/frontiermath-erdos`, feed: "epoch", default: false,
    rationale: "The one mathematics evaluation here that is not saturated, but few models have been run and scores sit near zero.",
    uncertainty: "95% interval computed here as 1.96 times the published standard error.",
  },
  {
    key: "sec_bench_pro", name: "SEC-Bench Pro", version: "As run by the reporting lab", capability: "Reproducing software vulnerabilities",
    measures: "Reproducing known vulnerabilities in real codebases from a description.",
    metric: "Pass@1", unit: "percent", direction: "higher", evaluator: "Reporting lab",
    methodologyUrl: "https://deploymentsafety.openai.com/gpt-6-2-astra-sol", sourceUrl: "https://deploymentsafety.openai.com/gpt-6-2-astra-sol", feed: "reported", default: false,
    rationale: "Only lab-reported results are available.",
  },
  {
    key: "mle_bench_revised", name: "MLE-Bench Revised", version: "72 problems", capability: "Machine-learning engineering",
    measures: "Kaggle-style machine-learning competitions, scored against human leaderboards.",
    metric: "Mean reference percentile (0–100)", unit: "index", direction: "higher", evaluator: "Reporting lab",
    methodologyUrl: "https://deploymentsafety.openai.com/gpt-6-2-astra-sol", sourceUrl: "https://deploymentsafety.openai.com/gpt-6-2-astra-sol", feed: "reported", default: false,
    rationale: "Only lab-reported results are available.",
  },
];

const BY_KEY = new Map(BENCHMARKS.map((b) => [b.key, b]));
export const benchmark = (key: BenchmarkKey): BenchmarkDefinition => BY_KEY.get(key)!;
export const isBenchmarkKey = (key: string): key is BenchmarkKey => BY_KEY.has(key as BenchmarkKey);
export const DEFAULT_BENCHMARKS = BENCHMARKS.filter((b) => b.default);

/** Considered and left out of the polled set, with the reason shown to visitors. */
export const EXCLUDED_BENCHMARKS: readonly { name: string; reason: string }[] = [
  { name: "SWE-bench Verified", reason: "The public leaderboard has no entry newer than February 2026 and its top results are self-submitted agent systems." },
  { name: "METR time horizons", reason: "The published results page states it is no longer actively updated." },
  { name: "Artificial Analysis Intelligence Index, Vals Index", reason: "Their data needs an account or API key, or is not published as open data." },
  { name: "Terminal-Bench 4.1, LiveBench 2.0", reason: "Credible, but neither publishes a stable data feed the tracker can refresh from." },
  { name: "LMArena", reason: "Its public data endpoint was returning errors when this set was chosen; it will be reconsidered." },
];

/** Attribution required by the data licences. */
export const ATTRIBUTION = {
  epoch: { text: "Epoch AI, ‘Capabilities & benchmarking’, epoch.ai/benchmarks (CC BY 4.0)", url: "https://epoch.ai/benchmarks" },
  arcprize: { text: "ARC Prize Foundation leaderboard, arcprize.org", url: "https://arcprize.org/leaderboard" },
} as const;
