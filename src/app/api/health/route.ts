// GET /api/health — liveness + ingest-health probe.
//
// This endpoint is wired to THREE consumers with different needs:
//   - the AWS Lambda Web Adapter readiness check (AWS_LWA_READINESS_CHECK_PATH)
//   - the Docker HEALTHCHECK
//   - external uptime monitors
//
// The first two must not be failed by a degraded dependency: returning non-200
// when Postgres is unreachable would stop the container from ever becoming
// ready, converting a degraded site into a total outage. So the HTTP status
// stays 200 and the JSON body carries the verdict — monitors assert on
// `"ok":true`, not on the status code.
//
// The body reports ingest health, not just "the process is up". The incident
// this was written for: `openai_codex_npm` failed every run for weeks and the
// whole site rendered empty states, while this endpoint answered
// `{"ok":true,"db":"up"}` and the deploy smoke test saw HTTP 200. A probe that
// cannot go red is not a probe.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { SOURCE_REGISTRY } from "@/lib/sources/registry";

export const runtime = "nodejs";
// Never cached: a stale "ok" masks an outage.
export const dynamic = "force-dynamic";

/** The slowest tier runs every 2h, so no poll inside 3h means the scheduler is stuck. */
const MAX_POLL_AGE_SECONDS = 3 * 60 * 60;
/** A source erroring this long has stopped being a blip. */
const MAX_SOURCE_ERROR_AGE_SECONDS = 6 * 60 * 60;

interface SourceState extends Record<string, unknown> {
  source: string;
  status: string;
  startedAt: string | Date;
}

export async function GET(): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  const db = tryGetDb();
  if (!db) {
    return NextResponse.json(
      { ok: false, db: "down", reason: "no database handle", lastPollAt: null },
      { headers },
    );
  }

  try {
    // Latest run per registry source, in one round trip.
    //
    // Deliberately NOT `select distinct on (source) … order by source, started_at desc`:
    // that ORDER BY mixes directions (source ASC, started_at DESC), which the
    // (source ASC, started_at ASC) index cannot serve, so Postgres seq-scanned and
    // quicksorted the whole table — 625 ms at 211k rows, on every probe, and the
    // Route53 health check probes this route every ~2 s. Driving the lookup from
    // the registry keys instead makes it ~28 single-direction index probes (~2 ms),
    // flat in table size. Sources that leave the registry drop out of `failing`,
    // which matches `neverRan` already being registry-driven.
    //
    // `array[…]` is built with sql.join because drizzle expands a bare JS-array
    // param into a `($1, $2, …)` record, which cannot cast to text[].
    const registryKeys = sql.join(
      SOURCE_REGISTRY.map((d) => sql`${d.key}`),
      sql`, `,
    );
    const latest = await db.execute<SourceState>(sql`
      select s.key as source, r.status, r.started_at as "startedAt"
      from unnest(array[${registryKeys}]::text[]) as s(key)
      cross join lateral (
        select status, started_at
        from poller_runs
        where source = s.key
        order by started_at desc
        limit 1
      ) r
    `);
    const rows = (latest.rows ?? []) as unknown as SourceState[];

    const now = Date.now();
    const lastPollAt = rows.reduce<Date | null>((acc, r) => {
      const d = new Date(r.startedAt);
      return !acc || d > acc ? d : acc;
    }, null);
    const lastPollAgeSeconds = lastPollAt
      ? Math.round((now - lastPollAt.getTime()) / 1000)
      : null;

    const failing = rows
      .filter((r) => r.status === "error")
      .filter((r) => (now - new Date(r.startedAt).getTime()) / 1000 <= MAX_SOURCE_ERROR_AGE_SECONDS * 4)
      .map((r) => r.source)
      .sort();

    // A source in the registry that has NEVER run is as broken as one erroring.
    const known = new Set(rows.map((r) => r.source));
    const neverRan = SOURCE_REGISTRY.map((d) => d.key)
      .filter((k) => !known.has(k))
      .sort();

    const reasons: string[] = [];
    if (lastPollAgeSeconds === null) reasons.push("no poller run recorded");
    else if (lastPollAgeSeconds > MAX_POLL_AGE_SECONDS) {
      reasons.push(`no poller run in ${lastPollAgeSeconds}s`);
    }
    if (failing.length > 0) reasons.push(`sources failing: ${failing.join(", ")}`);
    if (neverRan.length > 0) reasons.push(`sources never run: ${neverRan.join(", ")}`);

    return NextResponse.json(
      {
        ok: reasons.length === 0,
        db: "up",
        lastPollAt: lastPollAt?.toISOString() ?? null,
        lastPollAgeSeconds,
        sources: { total: SOURCE_REGISTRY.length, failing, neverRan },
        ...(reasons.length > 0 ? { reasons } : {}),
      },
      { headers },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: "down",
        reason: err instanceof Error ? err.message : String(err),
        lastPollAt: null,
      },
      { headers },
    );
  }
}
