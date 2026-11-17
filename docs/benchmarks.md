# Benchmark results and comparisons

`/compare` lets a visitor pick up to four tracked models from any lab and see
published benchmark results side by side. Model pages show the same results for
one model. This document says where the numbers come from, which benchmarks are
shown and why, and what the page will and will not claim.

## Where the numbers come from

| Source key | Publisher | What is fetched | Licence |
| --- | --- | --- | --- |
| `benchmarks_epoch` | Epoch AI | `https://epoch.ai/data/benchmark_data.zip` | CC BY 4.0, attribution shown on the page |
| `benchmarks_arcprize` | ARC Prize Foundation | `https://arcprize.org/media/data/evaluations.json` and `models.json` | Public leaderboard data, attributed and linked |

Both are ordinary tier-3 registry sources, so they refresh every two hours with
the rest of the tier, record a `poller_runs` row and appear in `/api/health`.
There is no API key, no login and no second scheduler. Only those three URLs are
fetched; redirects are refused.

Each source keeps one row in `benchmark_snapshots`: the accepted rows, their
hash, and the outcome of the latest attempt. A refresh that parses to the same
rows changes only `verified_at`. A refresh that cannot be parsed, or that loses
more than half its rows, records an error and leaves the accepted rows in place.
A publisher that is unreachable is recorded as `skipped` and shows as stale if it
lasts six hours. The table is created by the `migrate-v2` maintenance operation
during deployment.

Scores a lab publishes about its own models cannot be polled reliably: launch
pages change shape and some refuse automated clients. They live in
`src/lib/benchmarks/provider-reported.ts`, each with the page it came from, the
settings the source states and the date it was read. Add an entry only for a
number you have seen on the cited page.

## Which benchmarks, and why

A benchmark is in the default set when it measures something a reader can name,
documents its method, covers current models from all three labs, still separates
them, and publishes results as data the tracker can refresh without a key.

| Capability | Benchmark | Run by | Why it is a default |
| --- | --- | --- | --- |
| General capability | Epoch Capabilities Index | Epoch AI | Independent composite with a published 90% interval; broadest coverage |
| Reasoning on novel tasks | ARC-AGI-3 (semi-private) | ARC Prize Foundation | Held-back tasks, results per effort setting, far from its ceiling |
| Software engineering | FrontierSWE v2 | FrontierSWE | One harness for every model; wide spread |
| Agentic professional work | APEX-Agents | Mercor | Long non-coding tasks with a published ± margin |

Shown only when a selected model has a result: GPQA Diamond and ARC-AGI-2 (both
marked saturated), FrontierMath Erdős (few models run), CritPt v1 and
Vending-Bench 2, and lab-reported benchmarks. CritPt and Vending-Bench 2 were
first chosen as defaults and then removed: Epoch AI's own reviews rate both
Flawed (scoring defects in at least 20% of CritPt's challenges; an exploitable
simulation and unequal context between providers in Vending-Bench 2). They are
shown with that warning and a link to the review. Check a benchmark's Epoch page
for a review verdict before making it a default. The definitions, including the reason for each, are in
`src/lib/benchmarks/registry.ts`, which is also what the page renders.

Left out, with the reason shown on the page: SWE-bench Verified (no entry since
February 2026), METR time horizons (no longer updated), Artificial Analysis and
Vals (account, key or no open data), Terminal-Bench 4.1 and LiveBench 2.0 (no
data feed of their own, and Epoch's mirrors stop at April 2026 and November
2025), LMArena (its data endpoint was failing when the set was
chosen).

## What the page claims

- **Every score carries its context**: benchmark version, metric, direction, who
  ran it, the reasoning effort and harness where published, the interval where
  published, and a link to the source.
- **One score per model.** Where a model was run at several settings, the best
  independent result in the benchmark's standard harness is shown with its
  setting. Other settings, and ARC Prize's provider-adapter harness, are listed
  beneath it. Provider-adapter runs score far higher and are never mixed in.
- **A leader is named only when the data supports it**: every selected model has
  an independent result on the same benchmark and harness, at the same recorded
  reasoning effort, and their confidence intervals (of one level) do not
  overlap. Otherwise the row says why not. Today that means most rows name no
  leader. Where the intervals come from:
  - Epoch Capabilities Index: Epoch publishes a **90%** interval (the level is
    read from the archive's `eci_bootstraps.json`), shown and named as 90%.
  - GPQA Diamond and FrontierMath Erdős: a 95% Wilson interval computed from
    the score and the number of questions, used only when Epoch's published
    standard error is consistent with a single pass over them. "1.96 standard
    errors" is not used: it collapses to nothing at 0% and misleads near it.
  - A best-to-worst range of runs (FrontierSWE), or a ± the publisher does not
    define (APEX-Agents), is shown as published and never used.
- **Lab-reported scores are labelled and never ranked.**
- **Missing is not zero.** A model with no result shows "No published result".
  A failed read shows "temporarily unavailable", never "no results".

## Matching a publisher's label to a tracked model

Publishers spell models differently (`gpt-6.2-astra`, `gpt-6-2-astra`, "GPT-6.2
Astra"). Labels are compared on letters and digits only, and that is the only
leniency: no prefix, fuzzy or family matching. "GPT-6 Astra" cannot become
GPT-6.2 Astra, dated snapshots and `-fallback` variants stay unmatched, and a
label that fits two tracked models matches neither. Reasoning effort is split
off per feed from a closed list before matching. Matching happens when a page is
read, so a model that enters the catalog later picks up results already held.

## Checks

`npm run test:benchmarks` runs the feed parsers on real captured data, the
matching and leader rules, and (with `FRONTIER_TEST_DATABASE_URL`) publication
twice, failure handling and recovery against the isolated test database.

To add a benchmark: confirm it meets the five criteria, add its definition and
feed mapping, add fixture rows and tests, and say on the page why it is there.
