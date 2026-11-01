# Keep release ingestion below the response cap

On November 1, the Codex releases poller repeatedly exceeded the shared 10 MiB
body cap while requesting twenty releases. It then reported the misleading
error `returned status 200`. This was separate from tracker web throttling.
Four bounded public reads found five-release pages of 2.44–2.71 MB, each under
one second, covering twenty distinct tags. No response bodies were retained.
The query uses GitHub's documented [release pagination parameters](https://docs.github.com/en/rest/releases/releases#list-releases).

The adapter now requests at most four five-release pages from the same endpoint,
validates every required page before its single idempotent insert, and retains
the existing twenty-release scope, draft/prerelease policy and link-only output.
Extra asset metadata is discarded. The 10 MiB cap stays unchanged. All requests
share one twenty-second deadline with no automatic retry; failed reads remain
failures. This bounds HTTP waiting to twenty seconds, excluding cache/database
operations. Each page receives only the remaining time. Exhaustion and transport
errors identify the page without exposing raw provider errors.

The initial deployment used five seconds per page. Both its standard deployment
check and the subsequent natural poll recorded abort errors; no source events
were written. The opsbox's sub-second measurements did not represent Lambda's
transport. Replacing the per-page division with a shared deadline preserves the
same total twenty-second bound and fixed Lambda timeout, while allowing a slow
page to use time saved by others. Injected-clock tests cover six-second pages
within eighteen seconds total and exhaustion at twenty seconds without writes.

Every page reuses only its own validators from a successfully recorded source
run. An unchanged first page does not skip later pages: an older draft could
become public independently. A versioned, bounded manifest fits in the existing
source-run ETag field; the adapter extracts individual validators before HTTP.
Legacy or invalid metadata triggers a complete bounded refresh. Fetch results do
not advance an in-memory cache before all pages and the write complete. A later
failure therefore cannot make a warm retry skip uncommitted releases. Existing
callers retain their prior cache behavior. The manifest is itself a quoted opaque
ETag, so the old adapter can safely refetch on executable rollback.

Run `npm run test:releases` for isolated transport/database fixtures and
`npm run build:poller` for the actual bundle/load contract. The regression fails
against the old adapter. Coverage includes oversized/malformed/schema/HTTP and
network failures, no partial writes, warm retry, persisted ETag, draft/prerelease
semantics, empty/short pages, a changed later page with an unchanged first page,
legacy validators and duplicate delivery. Tests contact no live service.

The existing protected CI/deploy workflow ships the web image and all three
poller bundles, runs its normal tier checks and validates published data. Validate
the source's committed `poller_runs` result and health body after deployment;
HTTP 200 alone does not establish ingestion success. No extra manual polling or
schedule is needed. Public API request count is at most four per run; unchanged
pages return no body. Account access, concurrency, memory and timeout stay fixed.
The workflow captures all four function revisions before release work and uses
those revisions on code updates. An intervening external update stops deployment.
Local packaging uses a synchronous bundler so the storage owner can confirm all
children have exited; the switch preserves the exact ZIP bytes.

If the adapter regresses, stop further release work and restore the prior exact
poller ZIP through the owning revision-guarded Lambda rollback path. Retain its
artifact hash before release. That prior source is known failing on the large
response; it is a rollback state, not a healthy ingestion fallback. An executable
rollback does not remove already committed events. Concurrent upstream releases
can move page boundaries; existing unique source/tag insertion handles overlap,
and subsequent scheduled polling handles newly published entries. Do not claim
this is a historical backfill or an atomic snapshot of GitHub's release list.
