# Automate frontier profiles

## Outcome and boundaries

Keep the homepage, profiles, task guidance and direct comparisons current from
official provider documentation. Routine changes should publish without editing
TypeScript or deploying the website. Ambiguous source changes must retain the
last verified data and make the exception visible. No generated performance
ranking, new paid model API, new cloud service or second scheduler is needed.

Requested by Jaden on 2026-10-14 after PR #15. Implementation starts from main
`00eef3cf03b81180630963be760bb77a49e651ff`. Preserve the accepted presentation,
provider order, historical resource names and shared workspace. Reuse the
existing three poller Lambdas and normal CI/release path. The prior bounded
concurrent validation exception permits a 4 GiB local peak with memory checks;
use the shared storage runner when available. Preserve other sessions' work.

## Alternatives and selection

| Approach | Benefit | Failure mode | Decision |
| --- | --- | --- | --- |
| Scheduled pull requests updating static profiles | Auditable diffs, easy rollback | Routine human merges and redeploys; queued updates go stale | Useful for parser repairs, not routine data |
| Fetch and interpret provider docs on each page request | Immediate upstream changes | Visitor latency, source outages, inconsistent pages, repeated parsing | Reject |
| Scheduled deterministic extraction into validated database snapshots | Existing infrastructure, bounded requests, consistent data, independent freshness | Needs strict parsers, durable fetch state and an additive schema rollout | Select |

LLM-written comparisons are unnecessary for routine facts and could turn provider
marketing or hostile fetched text into unsupported recommendations. Structured
facts plus explanatory templates preserve a clear basis for each suggestion.

## Implementation sequence

1. **Evidence and contracts.** Capture the current official lineups, model detail
   and pricing documents as parser fixtures. Separate source publication dates,
   successful verification times and editorial review dates. Define typed model
   facts: identity, source-backed selection reason, modalities, token budget
   semantics, default/extended output, reasoning controls, access, standard token
   rates and price conditions/effective dates. Missing means unknown, never false
   or free. Bind every published profile to its exact model and source hashes.
2. **Durable ingestion.** Add additive tables for source documents, accepted model
   snapshots and each provider's selected model/sync status. Reuse registry and
   runner bookkeeping. Conditional requests may reuse only a previously stored
   matching body; a 304 without one requires an unconditional retry. Persist
   validators only alongside the body they describe. Cap bodies, request count,
   concurrency, retries and total run time. Allow only configured official HTTPS
   hosts/paths; reject redirects. Pin Gemini documentation to English with
   `?hl=en`; queryless URLs may redirect to other languages. Never execute
   fetched content.
3. **Provider adapters.** Discover candidates from explicit provider positioning
   in the current lineup, not lexical ID ordering, prices, context size or first
   seen dates. Require one eligible, generally available frontier candidate and
   matching detail identity. Exclude previews, retired and specialist variants.
   Unknown classification or unsupported price conditions blocks publication.
   Refresh details even when an index returns 304. Include Gemini pricing. This
   refreshes frontier facts on every run; the older broad catalog adapters remain
   independent. A fair refresh queue for the entire catalog is deferred rather
   than repeatedly overwriting incomplete scalar records.
4. **Atomic publication and recovery.** Validate the entire selected profile
   before publishing it with a successful verification timestamp. Isolate
   provider failures; keep each last-good profile and its original timestamp.
   Record a concise diagnostic on rejected refreshes, never credentials or full
   fetched bodies in logs. Serialize competing provider runs using a database
   transaction lock and prevent an older attempt overwriting a newer result.
   Keep accepted old model profiles for bookmarked links. Fetch-cache documents
   are separate from immutable accepted revisions, which embed source bodies,
   hashes and parser/schema versions. Retain the newest three distinct accepted
   revisions per model and always the selected revision. Unchanged content only
   advances its verification time. Existing run retention bounds diagnostics.
   Recovery pauses that provider in its state row, restores an accepted revision,
   repairs/tests the parser, then resumes. A paused provider remains visibly
   degraded and cannot republish until explicitly resumed.
5. **Read path and guidance.** Read one validated selection shared by homepage,
   profile pages and comparison UI. Preserve explicit comparison IDs, including
   archived profiles; defaults follow the current selections. Unknown IDs stay
   invalid only after a successful authoritative read. A database lookup failure
   for an ID outside the bundle renders temporarily unavailable, preserving the
   requested ID. An empty schema uses explicitly labeled bundled defaults; a
   partially populated schema uses accepted providers plus labeled per-provider
   fallback. A missing database or absent migration renders the dated bundled
   snapshot with a visible fallback notice, never a fake fresh timestamp. Show
   each model's verification time and stale/refresh-failed status. Derive task
   guidance from current verified capabilities and applicable rates. Unsupported
   claims about quality or speed remain absent; unknown data cannot win.
6. **Observability.** Expose per-provider selection, verification age and error
   state through the existing health response. Treat stalled individual sources,
   skipped parsing and stale snapshots as degraded even when other pollers run.
   HTTP 200 remains the readiness contract; JSON carries degradation. The site
   explains when a prior verified profile is being shown.
7. **Release.** Add a fixed, idempotent, transactional migration operation to the
   poller bundle, invoked explicitly by deployment before the new web revision.
   No DDL on web requests, generic SQL execution API, destructive migration or
   production seed. CI verifies the migration against isolated PostgreSQL.
   Deploy sequence: build web/assets and poller from one SHA; publish assets;
   update schema-tolerant pollers; invoke and assert the fixed migration;
   populate and assert three accepted database profiles; only then switch web
   code and invalidate CDN. Until migration succeeds, new source handlers defer
   without breaking existing ingestion. Schema inspection must distinguish
   absence from connection failure. On failed migration/prepopulation leave the
   old web active and restore the previous poller artifact if needed. After web
   activation, rollback both web and poller code to the prior release; additive
   tables remain. Deployment must assert all three current IDs, hashes, freshness
   and non-fallback status; fallback HTML cannot satisfy acceptance.
   Deploy the same reviewed SHA, run scheduled-shape smoke checks, verify public
   profiles and health, then observe scheduled freshness. Old application code
   can run against the additive schema; retain the reviewed bundled fallback.

## Verification and acceptance

- Offline source fixtures from all three providers; identity mismatch, ambiguous
  candidate, reordered models, new eligible replacement, preview/retired models,
  missing fields, unknown modalities and source format drift.
- Prices: standard vs batch/cache, token units, conditional long-context rates,
  announced changes before/on/after their UTC date, expired offers and unparsed
  qualifiers. Shared context and output modes must remain distinct.
- Ingestion: unchanged index with changed detail; 200/304, missing cached body,
  failed parse followed by 304, timeout/429/5xx/oversize, prohibited redirect,
  provider isolation, repeated runs and concurrent/older completion. No failed
  run refreshes last-good verification time or corrupts an accepted snapshot.
- Isolated database migration twice, atomic publish/failure recovery, profile
  history, read failure vs empty results, and backward-compatible fallback.
- Types, lint, read/UI/ingestion tests, web build, dynamic-route guard and poller
  bundle. Live source read-only dry run must produce all three complete profiles
  with condition-aware facts. No live poller calls merely for UI tests.
- Browser checks at 375/412/430 and desktop: current and historical profiles,
  pair/all comparison, URL/Back, unknown IDs, differences, task guidance,
  keyboard/axe, overflow, stale and database-fallback states.
- Independent Astra medium review of this plan and final implementation/evidence.
  Resolve material findings before publication. CI and deployment receipts must
  identify the actual SHA; fresh HTTP success alone is not data acceptance.

## Risks, cost and maintenance

Provider HTML/Markdown can change. Conservative rejection preserves accuracy but
may require occasional adapter repairs; zero human attention forever is not a
credible promise. Unknown capabilities and newly introduced pricing dimensions
are shown as unavailable or hold the update, never inferred from an older model.
Cross-provider benchmark claims need a separate comparable-evaluation source and
are outside this release. Chat subscription features/prices remain separate.

Use the existing two-hour tier for the new profile sources. Budget a small bounded
set of public document reads per provider, with conditional requests; no paid
inference calls, extra scheduler, new instance or external messaging. The AWS
authority's October 11 allowance was $211.80 plus $25 reserve under $250; it is a
dated platform allowance, not a fresh bill or a cost measurement for this change.
Measure the new poller's request/runtime footprint and retain it in release
evidence. Local build peak is 4 GiB; retain review/test receipts and remove only
task-owned disposable dependencies/build outputs after verification.

## Review and execution record

Independent Astra medium plan review completed (evidence:
`/tmp/llm-frontier-automation/plan-review-actual.txt`). It preferred the selected
architecture and required the six corrections now incorporated above: bootstrap,
immutable accepted evidence/recovery, explicit selection rules, bounded scope,
outage bookmark semantics and non-fallback release acceptance. The initial review
attempt incorrectly tried to launch a nested reviewer; the corrected invocation
performed the actual independent review. No design acceptance is inferred from
the failed attempt.

Provider selection contract:

- OpenAI: inspect only the introductory recommendation before `## Featured
  models`; require exactly one linked model called the flagship for complex
  reasoning/coding there. Require matching detail Model ID and text output;
  reject explicit preview/deprecation/access restriction of the model. The full
  catalog contains historical/specialist flagships and is not a selection list.
- Claude: inspect the current comparison-table header positioning; require
  exactly one model described for demanding reasoning and long-horizon agentic
  work. Match its API ID and detail link to an active detail page. This deliberately
  differs from the provider's most-workloads recommendation. Optional preview
  features do not make a stable model a preview.
- Gemini: inspect stable model cards, require exactly one card positioned as the
  flagship reasoning model, then verify its model code and stable version on the
  detail page. Exclude creative TTS/live/image specialists. More than one matching
  candidate, or no supported positioning, holds the previous choice for review.

Each provider refresh has at most 4 documents, 2 simultaneous HTTP requests,
12 seconds per request, no automatic 429/5xx retry, and a 45-second run deadline.
The three new sources read 10 documents normally, with a hard limit of 24
requests including orphan-304 retries and 6 active requests across tier 3. Bodies
are capped at 2 MiB each. Their shared database lock spans one provider refresh;
concurrent refreshes defer. Public UI never fetches upstream docs. No broad
catalog refresh queue is introduced.

Implementation is complete locally. The first code review required lifecycle
checks, strict pricing-condition validation, a failure record outside aborted
SQL transactions, and public reads that omit evidence bodies; all four are
implemented with regression coverage. Follow-up probes found Markdown status
bullets and pricing footnotes still bypassed rejection; those cases now have
explicit structure checks and regression tests. Database diagnostics omit SQL parameters.
Rejected fetch caches are bounded and comparison notices follow URL changes.

Local validation on October 14 passed: 9 frontier tests (including isolated
PostgreSQL), 15 UI tests, 12 read tests, types, lint (existing warnings), web build,
dynamic-route guard and poller build. Live official-source extraction accepted
all three providers in 10 requests (4/3/3), with observed per-provider durations
of 0.1–7.2 seconds across the recorded runs. These are dry runs, not a service
latency promise.

Chromium/WebKit passed 32 viewport-route checks and 10 axe scans with no
violations. Rapid full-document navigation produced WebKit prefetch cancellation
errors; a fresh normal-navigation run completed without errors. Additional
browser checks passed model replacement without deployment, archived links,
cross-generation comparison, stale/failed notices, missing-ID Back navigation
and database-outage fallback with unknown bookmarks preserved. Rendered local
revision hashes match accepted database state. Evidence is retained under
`/tmp/llm-frontier-automation/`. Final independent review and production delivery
are recorded in the pull request and deployment receipts.
