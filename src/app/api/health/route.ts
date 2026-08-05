// GET /api/health — liveness probe for Docker healthcheck / Caddy / external monitors.

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { pollerRuns } from "@/lib/db/schema";

export const runtime = "nodejs";
// Intentionally NOT cached: this is a liveness probe — monitors need the
// current db/lastPollAt state, and a stale cached "ok" would mask outages.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const db = tryGetDb();
  if (!db) {
    return NextResponse.json({ ok: true, db: "down", lastPollAt: null });
  }

  try {
    const rows = await db
      .select({ startedAt: pollerRuns.startedAt })
      .from(pollerRuns)
      .orderBy(desc(pollerRuns.startedAt))
      .limit(1);
    return NextResponse.json({
      ok: true,
      db: "up",
      lastPollAt: rows[0]?.startedAt?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({ ok: true, db: "down", lastPollAt: null });
  }
}
