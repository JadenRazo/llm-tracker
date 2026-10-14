# Operate frontier refreshes

Read `/api/health` as JSON. HTTP 200 only establishes readiness. `frontier.ok`
must be true and each provider must be `current`, with an accepted model ID,
revision hash, source hashes and recent verification time. `failed`, `stale`,
`paused` and `missing` require attention. Pages keep the last accepted profile or
show the explicitly dated bundled fallback; a fallback is never release-ready.

## Normal operation

The three `frontier_*` registry sources run on the existing two-hour tier.
Each checks its lineup plus at most three other official documents. HTTP uses
durable validators and matching bodies; a 304 still goes through parsing and
validation. Each provider permits two concurrent requests, a 45-second fetch
deadline and at most eight requests including an orphan-304 retry. Responses are
capped at 2 MiB. There are no paid model calls or new schedules.
Gemini documents explicitly use `?hl=en` to keep parser inputs in English.
Redirects, other query parameters and URLs outside the official allowlist fail
the refresh instead of expanding its network access.

`frontier_documents` is replaceable HTTP cache. `frontier_revisions` preserves
accepted facts and their complete source bodies, hashes and parser version.
Three distinct revisions per model are retained, plus any selected revision;
older model IDs remain available for bookmarks. `frontier_states` points to the
selected revision and records exceptions. Failed extraction never advances the
accepted verification time. The broad catalog remains independent.

Inspect the source's latest `poller_runs` entry and `frontier_states.error`.
Repair upstream-format changes in code with a fixture reproducing the failure.
Do not update timestamps, clear errors or replace data just to silence health.
Routine failures recover automatically when a later run validates the documents.

## Release order and recovery

The deployment builds one SHA, uploads assets, updates the schema-tolerant pollers,
explicitly invokes the fixed additive migration, runs scheduled-shape ingestion
and requires three accepted profiles. Only then does it switch the web Lambda,
invalidate the CDN and match rendered revision hashes to health.

Before migration, new source handlers defer; the existing sources keep running.
A failed migration rolls back its transaction. If migration or initial profiles
fail, the old web stays active. Inspect the failing step; repair and redeploy or
restore the previous poller bundle. The additive tables need not be removed.

For code rollback, use the prior successful deployment's SHA-tagged ECR web image
and poller bundle built from that exact SHA and committed lockfile. If the prior
bundle was not retained, build it from a clean checkout of that SHA using
`npm ci --ignore-scripts --no-audit --no-fund` then `npm run build:poller`, under
the workspace storage controls. Update all three poller functions and the web
function, wait for updates, invalidate the existing distribution and verify
health and pages. Do not delete additive tables or historical hashed assets.

For a bad *accepted data update*, use an earlier retained revision and pause that
provider. The existing IAM-protected tier-3 Lambda accepts these fixed operations
(not public web endpoints or a generic SQL interface):

```json
{"frontierMaintenance":"status"}
{"frontierMaintenance":"restore","provider":"openai","revisionId":"<retained 64-character revision hash>"}
{"frontierMaintenance":"resume","provider":"openai"}
```

Invoke with AWS CLI `--cli-binary-format raw-in-base64-out --payload`, storing the
response in a file. Assert `FunctionError` is absent and inspect the returned
JSON. Production recovery remains a deliberate authorized operation. Restore
validates provider ownership and pauses publication; old verification timestamps
stay old. Repair/test/deploy the adapter before resume. Resume remains degraded
until the next scheduled refresh succeeds. Never pass arbitrary SQL or secrets.

The fixed migration operation is `{"frontierMaintenance":"migrate-v1"}`;
deployment invokes it explicitly. It is idempotent, additive and transactional.
No page request or ordinary poller tick performs DDL.

## Validation

`npm run test:frontier` runs source fixtures and transport/failure tests. Set
`FRONTIER_TEST_DATABASE_URL` to an isolated localhost database named
`frontier_test` to include destructive fixture-only migration/recovery tests.
The suite refuses a different host/database. CI creates its own PostgreSQL
service; no production database is used for builds or tests.

After a release, `node scripts/verify-frontier-live.mjs https://llm.raizhost.com`
asserts all three current database profiles and matches homepage, comparison and
profile HTML to those exact revisions. Also inspect normal browser interaction,
mobile layouts, fallback/archived notices and source freshness after a scheduled
tick. A healthy page alone cannot establish healthy ingestion.
