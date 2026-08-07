// Route guard for the whole `/[provider]/...` subtree. `generateStaticParams`
// enumerates the known providers; `dynamicParams = false` makes any *other*
// first segment (e.g. `/foo`) a real routing-level 404 — returned before any
// rendering or streaming, so the HTTP status is a true 404 rather than the
// soft-404 (200 + noindex) you get from `notFound()` on a `force-dynamic`,
// already-streaming page. The `notFound()` below stays as defense-in-depth.

import { notFound } from "next/navigation";
import { PROVIDERS } from "@/lib/providers";
import { parseProviderParam } from "@/lib/provider-route";

export function generateStaticParams() {
  return PROVIDERS.map((provider) => ({ provider }));
}

// Unlisted providers 404 at the routing layer — see the note above.
export const dynamicParams = false;

export default async function ProviderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (!parseProviderParam(provider)) notFound();
  return <>{children}</>;
}
