// Unknown public routes reuse a real, prebuilt not-found page. Rewriting to an
// ungenerated guide slug caused Next.js NoFallbackError on the deployed image.
// Keep the explicit 404 status and existing UI without rendering a missing SSG
// fallback for each request. API and Next internals retain their own behavior.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isProvider } from "@/lib/providers";


// Non-provider top-level segments that must pass through untouched: the legacy
// sources are 308-redirected by next.config (which runs *after* middleware) —
// eating them here would break the rebrand redirects.
const LEGACY_REDIRECT_ROOTS = new Set([
  "claude-code",
  "changelog",
  "models",
  "status",
  "guides",
  "tips",
]);

// Valid sub-pages under `/[provider]/...`. Article slugs must also be present
// in the compiled content manifest before reaching dynamicParams=false pages.
const PROVIDER_SUBPAGES = new Set([
  "models",
  "releases",
  "tips",
  "guides",
  "changelog",
  "status",
]);

const HARD_404_TARGET = "/not-found-page";
const STATIC_ARTICLE_ROUTES = new Set<string>(JSON.parse(process.env.STATIC_ARTICLE_ROUTES ?? "[]"));

export function isUnknownPath(pathname: string, articleRoutes = STATIC_ARTICLE_ROUTES): boolean {
  // Source-owned pages and extensionless metadata routes.
  // The rewrite destination must pass through, including internal proxy hops.
  if ([HARD_404_TARGET, "/opengraph-image", "/icon.svg", "/rss.xml", "/subscribe", "/compare"].includes(pathname))
    return false;
  const segments = pathname.split("/").filter(Boolean);

  // "/" — the cross-provider home.
  if (segments.length === 0) return false;

  const [first, second] = segments;

  // Model existence is database-owned. Edge middleware validates only path shape.
  if (first === "models" && segments.length > 1)
    return segments.length !== 2 || !/^(?:claude|gpt|gemini)-[a-z0-9.-]{1,90}$/.test(second);

  // Legacy redirect roots pass straight through to next.config's 308s.
  if (LEGACY_REDIRECT_ROOTS.has(first)) return false;

  // Unknown first segment that isn't a provider → 404.
  if (!isProvider(first)) return true;

  if (second === "rss.xml" && segments.length === 2) return false;

  // Valid provider. "/[provider]" is the provider home.
  if (segments.length === 1) return false;

  // "/[provider]/<sub>" — only source-owned pages and known article slugs pass.
  if (!PROVIDER_SUBPAGES.has(second)) return true;
  if (segments.length === 2) return false;
  if ((second === "guides" || second === "tips") && segments.length === 3)
    return !articleRoutes.has(`/${segments.join("/")}`);
  return true;
}

export function middleware(request: NextRequest): NextResponse {
  if (isUnknownPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL(HARD_404_TARGET, request.url), {
      status: 404,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60", "X-Robots-Tag": "noindex" },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Match dotted unknown paths too; the old broad dot exclusion produced a
  // streamed 200 with not-found UI. Known metadata/feed routes pass above.
  matcher: ["/((?!api/|api$|_next/).*)"],
};
