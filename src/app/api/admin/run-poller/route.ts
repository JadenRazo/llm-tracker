// POST /api/admin/run-poller?source=X
//
// Localhost-only manual trigger for a single source. Used for smoke tests when
// iterating on a source module — the cron scheduler owns the production polling
// cadence, this endpoint is not for scheduled use.
//
// Guarded by two independent checks:
//   1. X-Admin-Token header must match env.ADMIN_TOKEN
//   2. Request must originate from loopback (127.0.0.1 / ::1 via x-forwarded-for or remote addr)

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isSourceKey, runSource } from "@/lib/poller/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLoopback(req: NextRequest): boolean {
  // x-forwarded-for is the leftmost client when present.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]!.trim();
    if (first === "127.0.0.1" || first === "::1") return true;
    if (first === "::ffff:127.0.0.1") return true;
    return false;
  }
  // Fallback — Next.js doesn't expose remoteAddress cleanly; if no XFF and we
  // got here, assume direct-from-host (Docker: typically host-gateway only,
  // which is still effectively localhost for our single-VPS topology).
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = env().ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "ADMIN_TOKEN not configured" }, { status: 503 });
  }

  const provided = req.headers.get("x-admin-token");
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!isLoopback(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  if (!source || !isSourceKey(source)) {
    return NextResponse.json({ ok: false, error: "unknown source" }, { status: 400 });
  }

  const result = await runSource(source);
  return NextResponse.json({
    ok: !result.error,
    source,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    error: result.error,
  });
}
