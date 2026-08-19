// GET /{provider}/rss.xml — one provider's feed.

import { loadFeedEvents, renderRss } from "@/lib/rss";
import { parseProviderParam } from "@/lib/provider-route";
import { PROVIDERS } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return PROVIDERS.map((provider) => ({ provider }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) return new Response("Not found", { status: 404 });

  const rows = await loadFeedEvents(provider);
  return new Response(renderRss(rows, provider), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
