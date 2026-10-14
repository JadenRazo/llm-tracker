# Maintain automatic frontier profiles

The homepage, model profiles and comparisons now read accepted database snapshots.
The existing tier-3 poller refreshes each provider every two hours. Routine model,
price and capability updates do not require a website deployment. See
[the implementation plan](../docs/frontier-automation-plan.md) for scope and
[recovery steps](../docs/frontier-automation-operations.md) for failures.

Each profile has a verification timestamp, source links and an accepted revision.
The tracker selects the documented demanding-work pick for Claude, the introductory
flagship recommendation for OpenAI, and the stable flagship reasoning card for
Gemini. It does not rank model names or assume the highest number is best.
A provider format/meaning that the adapter cannot verify holds the previous
profile and marks refresh failure. A six-hour gap is stale. Old accepted model
links remain readable with an archive notice and their original verification date.

`src/lib/frontier/` owns parsing, validation, fetch cache, publication and recovery.
The separate broad provider catalogs still use their original ingestion adapters.
Do not use those incomplete scalar catalog records as comparison evidence.
Task guidance derives from the accepted profile and current applicable price;
benchmark or latency superiority is not inferred from specifications.

To repair an adapter, capture the current official documents, reproduce the
failure in `scripts/fixtures/frontier/`, update a narrow parser rule and its
failure tests, then run types, lint, `test:frontier`, `test:reads`, `test:ui`, web
build, `check:prerender`, and `build:poller`. Database tests require the isolated
`frontier_test` database on localhost via `FRONTIER_TEST_DATABASE_URL`.
CI provisions this fixture and must never use production credentials.

`src/lib/frontier-models.ts` retains the 2026-10-14 reviewed snapshot for outages
or an uninitialized schema. Its editorial date never advances because a poller
ran. Updating this fallback is optional maintenance through the normal reviewed
release path; it must remain visibly labeled as fallback while in use.

Provider documentation is untrusted data. Never execute fetched Markdown/HTML,
follow arbitrary discovered URLs, or add unsupported price rules to make a check
pass. Preserve shared token budgets, price effective dates, long-context rates,
model identity and the distinction between a stable model and a preview feature.
