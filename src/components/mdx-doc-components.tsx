// Custom MDX component overrides for next-mdx-remote/rsc.
//
// These run on the server (RSC): they resolve the link/token against
// cli_reference via the doc-resolver and, when it matches, render the client
// DocPopover with the (serializable) row. When nothing resolves they fall
// back to a plain navigating link / inline <code>, so unrelated markup is
// untouched.

import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { DocPopover } from "@/components/ui/doc-popover";
import {
  isDocsUrl,
  resolveDocToken,
  resolveDocUrl,
} from "@/lib/doc-resolver";

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

/**
 * `<a>` override. If the href is a resolvable code.claude.com docs URL, render
 * the DocPopover inline-trigger (keeping the original link text). Otherwise a
 * plain anchor — external links open in a new tab.
 */
async function MdxAnchor({ href, children, ...rest }: AnchorProps) {
  if (href && isDocsUrl(href)) {
    const row = await resolveDocUrl(href);
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

type CodeProps = HTMLAttributes<HTMLElement>;

/**
 * Inline `<code>` override. If the code text is a known command/flag/hook
 * token, render the DocPopover inline-trigger; otherwise a normal <code>.
 * Block code (```fenced```) is wrapped in <pre><code> by MDX — those <code>
 * children are arrays/elements, not bare token strings, so they fall through
 * to the plain branch and are left alone.
 */
async function MdxCode({ children, ...rest }: CodeProps) {
  const text = textOf(children).trim();
  // Cheap pre-filter: only the shapes a token can take. Avoids a resolver
  // call (and its index access) for ordinary inline code.
  const tokenish =
    /^\/[\w-]+$/.test(text) ||
    /^-{1,2}[\w-]+$/.test(text) ||
    /^[A-Z][A-Za-z]+$/.test(text) ||
    /^claude\s+[\w-]+/.test(text);

  if (tokenish) {
    const row = await resolveDocToken(text);
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

/** Pass to every `<MDXRemote components={...} />`. */
export const mdxDocComponents = {
  a: MdxAnchor,
  code: MdxCode,
};
