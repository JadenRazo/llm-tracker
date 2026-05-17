// Root catch-all hard-404. Any path that matches no more-specific route lands
// here. `generateStaticParams` returns nothing and `dynamicParams = false`,
// so on *direct* routing every such path is rejected at the routing layer —
// Next returns a genuine HTTP 404 and renders the global `not-found.tsx`
// (with its automatic `<meta name="robots" content="noindex">`). Same
// mechanism the `[provider]/guides/[slug]` route uses for unknown slugs.
//
// More specific routes (`/`, `/[provider]/...`, the legacy redirects) always
// win over this catch-all, so valid paths are unaffected.

import { notFound } from "next/navigation";

export function generateStaticParams(): { notFound: string[] }[] {
  return [];
}

export const dynamicParams = false;

export default function CatchAllNotFound(): never {
  notFound();
}
