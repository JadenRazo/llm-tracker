// GET /rss.xml — the cross-provider feed.

import { loadFeedEvents, renderRss } from "@/lib/rss";

export const runtime = "nodejs";
// Rendered per request against the live DB, like every other data surface here.
// The CDN caches it via the Cache-Control below (see next.config.ts for the
// reasoning behind short, explicit windows).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const rows = await loadFeedEvents();
  return new Response(renderRss(rows), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
