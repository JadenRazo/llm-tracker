// Shared helpers for the `/[provider]/...` route segment: validate the URL
// param and derive the active provider from a pathname (used by the header
// switcher, which is a client component, and by route guards).

import { isProvider, type Provider } from "@/lib/providers";

/**
 * Parse the `[provider]` route param. Returns the typed provider or null —
 * pages call `notFound()` on null so unknown segments 404 rather than crash.
 */
export function parseProviderParam(raw: string | undefined): Provider | null {
  if (raw && isProvider(raw)) return raw;
  return null;
}

/**
 * Derive the active provider from a pathname (`/openai/releases` → "openai").
 * Returns null on the cross-provider root and any non-provider path so the
 * switcher can show an "all" state.
 */
export function providerFromPathname(pathname: string): Provider | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg && isProvider(seg) ? seg : null;
}

/**
 * Given the current pathname and a target provider, return the equivalent
 * path under the target provider. Switching on `/claude/releases` →
 * `/openai/releases`; from a non-provider path → the provider home.
 */
export function swapProviderInPath(
  pathname: string,
  target: Provider,
): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && isProvider(segments[0])) {
    if (segments[0] === target) return pathname;
    segments[0] = target;
    // Article slugs belong to one provider; switch to the equivalent section.
    if (segments.length > 2 && (segments[1] === "tips" || segments[1] === "guides")) {
      return `/${segments.slice(0, 2).join("/")}`;
    }
    return `/${segments.join("/")}`;
  }
  return `/${target}`;
}

/** Provider home matches exactly; section links also own their detail pages. */
export function isSectionActive(pathname: string, provider: Provider, suffix: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  const href = `/${provider}${suffix}`;
  return path === href || (suffix !== "" && path.startsWith(`${href}/`));
}
