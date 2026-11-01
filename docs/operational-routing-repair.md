# Unknown-route execution repair

The November 1 candidate returns an actual HTTP 404 with the existing not-found
document and a 60-second public cache lifetime. Unknown article slugs no longer
ask Next.js to render an ungenerated static guide. Known article, feed, metadata
and database route behavior remains covered by the existing guards and tests.

The exact deployed image reproduced `NoFallbackError` on isolated unknown paths
and returned a soft 404 (HTTP 200) for a dotted unknown path. Production logs
contained 25 matching exceptions during the November 1 throttle burst. This
supports removing the broken fallback work; it does not identify every historical
caller or prove that every throttle came from those routes. The regional quota
was ten concurrent executions. No capacity or database limit was changed.

After `npm run build`, run `npm run check:prerender` and `npm run check:404`.
The latter starts the actual standalone server without database credentials or
pollers, checks 404 status/cache/UI, HEAD, every compiled article, feeds and
metadata, and rejects `NoFallbackError`. The package guard also requires the
built not-found document in the standalone output. Typecheck, UI/read regressions
and lint passed locally on Node 22; lint retains existing unrelated warnings.

**Release remains blocked as of November 1, 2026, 22:46 UTC.** The existing
`assert-frontier-status.mjs` gate rejected the live state: Gemini's accepted
revision was last verified October 14 and is failed. Its current source rejects
an unrecognized pricing qualifier. The Codex-release source also reports errors.
Do not bypass the gate, fabricate accepted data, or trigger the whole deploy
workflow merely to ship this web-only repair. Restore source-backed readiness
through the owning ingestion process, then use the established release checks.

The candidate has not been pushed or deployed. Before a later release, refresh
the source revision, readiness gate, function revision and image digest, preserve
the prior image, publish assets before switching code, and retain old bundles.
The application workflow owns executable delivery; no infrastructure apply is
needed. Roll back a harmful web release to the captured prior immutable image
using a fresh function revision guard and the existing Lambda rollback runbook.
That rollback would restore the known missing-route defect; it is not a claim
that the prior release is healthy. Comparable-traffic throttle verification is
still pending. Do not saturate the production account to obtain it.
