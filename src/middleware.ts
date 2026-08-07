// Hard-404 middleware. Replaces the prior soft-404 (HTTP 200 + noindex on a
// streaming `notFound()`) with a real HTTP 404 for unknown paths, while
// leaving every valid route — and the next.config legacy 308 redirects —
// untouched.
//
// Mechanism: when the path is unknown, rewrite to the
// `/[provider]/guides/[slug]` route with a slug no content file can produce.
// That route has `dynamicParams = false` + real `generateStaticParams`, so it
// renders cleanly (a static fallback exists — no standalone `NoFallbackError`)
// and resolves to `notFound()` → the styled global `not-found.tsx` with Next's
// automatic `<meta name="robots" content="noindex">`. The explicit
// `{ status: 404 }` on the rewrite makes the response a *genuine* HTTP 404
// (a plain rewrite would keep 200). The browser URL is preserved (rewrite,
// not redirect), so the user sees the clean not-found page for the path typed.
//
// This is the segment-level gate. The root `[...notFound]` catch-all
// (`dynamicParams = false`) is the routing-layer backstop for any unmatched
// path the matcher below excludes (e.g. dotted paths); page-level
// `notFound()` / `dynamicParams = false` guards remain as defense-in-depth.
//
// Pure path logic — no DB, no async, no extra deps (next/server only).

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

// Valid sub-pages under `/[provider]/...`. Mirrors the route tree in
// src/app/[provider]/. Slug pages (`guides/<slug>`, `tips/<slug>`) keep their
// own `dynamicParams = false` + `notFound()` guards for unknown slugs, so they
// pass through here and 404 themselves if the slug is bad.
const PROVIDER_SUBPAGES = new Set([
  "models",
  "releases",
  "tips",
  "guides",
  "changelog",
  "status",
]);

// A guide slug no markdown file will ever produce. The
// `[provider]/guides/[slug]` route is `dynamicParams = false` with real
// static params, so this renders the not-found UI without a standalone
// fallback error — the one rewrite target that pairs cleanly with the
// explicit 404 status below.
const HARD_404_TARGET = "/claude/guides/__hard_404__";

function isUnknownPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  // "/" — the cross-provider home.
  if (segments.length === 0) return false;

  const [first, second] = segments;

  // Legacy redirect roots pass straight through to next.config's 308s.
  if (LEGACY_REDIRECT_ROOTS.has(first)) return false;

  // Unknown first segment that isn't a provider → 404.
  if (!isProvider(first)) return true;

  // Valid provider. "/[provider]" is the provider home.
  if (segments.length === 1) return false;

  // "/[provider]/<sub>" — only the known sub-pages are valid. Slug routes
  // (guides/tips + a slug) pass through; their pages 404 bad slugs themselves.
  return !PROVIDER_SUBPAGES.has(second);
}

export function middleware(request: NextRequest): NextResponse {
  if (isUnknownPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL(HARD_404_TARGET, request.url), {
      status: 404,
    });
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and static assets
  // (any path segment containing a dot, e.g. favicon.ico, *.png). Keeps the
  // middleware off infra paths entirely; the catch-all backstops the rest.
  matcher: ["/((?!api|_next/static|_next/image|.*\\.).*)"],
};
