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
    segments[0] = target;
    return `/${segments.join("/")}`;
  }
  return `/${target}`;
}
