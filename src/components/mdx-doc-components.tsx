// Custom MDX component overrides for next-mdx-remote/rsc.
//
// These run on the server (RSC): they resolve the link/token against
// cli_reference via the doc-resolver and, when it matches, render the client
// DocPopover with the (serializable) row. When nothing resolves they fall
// back to a plain navigating link / inline <code>, so unrelated markup is
// untouched.
//
// Phase 2.3: resolution is provider-scoped. `mdxDocComponents(provider)`
// returns a component map bound to that provider so a token in an OpenAI
// guide resolves the OpenAI cli_reference row. Call sites under
// `/[provider]/...` pass the active provider; the default is Claude (legacy
// behavior preserved).

import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import { DocPopover } from "@/components/ui/doc-popover";
import {
  isDocsUrl,
  resolveDocToken,
  resolveDocUrl,
} from "@/lib/doc-resolver";
import { DEFAULT_PROVIDER, type Provider } from "@/lib/providers";

/** Plain text of a (possibly nested) MDX child, for token matching. */
function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props != null &&
    typeof children.props === "object" &&
    "children" in children.props
  ) {
    return textOf((children.props as { children: ReactNode }).children);
  }
  return "";
}

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;
type CodeProps = HTMLAttributes<HTMLElement>;

/**
 * Build the MDX component map for `provider`. Cached per provider so repeated
 * MDXRemote renders within a request reuse the same component identities.
 */
const cache = new Map<Provider, MDXComponents>();

async function MdxAnchorImpl(
  provider: Provider,
  { href, children, ...rest }: AnchorProps,
) {
  if (href && isDocsUrl(href)) {
    const row = await resolveDocUrl(href, provider);
    if (row) {
      return (
        <DocPopover item={row} variant="inline">
          {children}
        </DocPopover>
      );
    }
  }

  const external = href ? /^https?:\/\//.test(href) : false;
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

async function MdxCodeImpl(
  provider: Provider,
  { children, ...rest }: CodeProps,
) {
  const text = textOf(children).trim();
  // Cheap pre-filter: only the shapes a token can take. Avoids a resolver
  // call (and its index access) for ordinary inline code.
  const tokenish =
    /^\/[\w-]+$/.test(text) ||
    /^-{1,2}[\w-]+$/.test(text) ||
    /^[A-Z][A-Za-z]+$/.test(text) ||
    /^claude\s+[\w-]+/.test(text);

  if (tokenish) {
    const row = await resolveDocToken(text, provider);
    if (row) {
      return (
        <DocPopover item={row} variant="inline">
          {children}
        </DocPopover>
      );
    }
  }

  return <code {...rest}>{children}</code>;
}

/**
 * Returns the `components` prop for `<MDXRemote />`, with link/token
 * resolution scoped to `provider`.
 */
export function mdxDocComponents(
  provider: Provider = DEFAULT_PROVIDER,
): MDXComponents {
  const cached = cache.get(provider);
  if (cached) return cached;

  // Bind the provider into stable named components so React's reconciler
  // sees one component type per provider, not a fresh closure per render.
  const map: MDXComponents = {
    a: (props: AnchorProps) => MdxAnchorImpl(provider, props),
    code: (props: CodeProps) => MdxCodeImpl(provider, props),
  };
  cache.set(provider, map);
  return map;
}
