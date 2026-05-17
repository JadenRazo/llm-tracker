// Shared MDX sanitizer for poller-sourced `bodyMd`.
//
// Extracted verbatim (behavior-preserving) from src/app/claude-code/page.tsx
// so every render site that feeds untrusted upstream `events.bodyMd` through
// <MDXRemote> shares one allowlist + escaping pass. Do NOT add rehype-raw at
// any call site: this scrub is the security boundary; rehype-raw re-opens it.

/** HTML tags safe to let through to MDX — anything else gets escaped. Kept
 * intentionally narrow: the release bodies are prose + code, not rich HTML. */
const HTML_ALLOWLIST = new Set([
  "a",
  "p",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "img",
  "span",
  "div",
]);

/**
 * Escapes bare `<word>` / `</word>` / `<word/>` tokens that aren't in the
 * HTML allowlist. This prevents MDX from trying to interpret source-code
 * placeholders like `<your-custom-agent>` as JSX elements and crashing the
 * render pass. Tokens inside fenced code blocks and inline backticks are
 * preserved verbatim — MDX already escapes those contexts correctly.
 */
export function sanitizeMdx(body: string): string {
  if (!body) return body;

  // Preserve fenced code blocks and inline code by extracting them first,
  // running the tag scrub on everything else, then re-inserting.
  const placeholders: string[] = [];
  const PLACEHOLDER = (i: number) => `\u0000MDXSAFE${i}\u0000`;

  let protectedText = body;

  // Fenced code: ```lang?\n...\n```
  protectedText = protectedText.replace(/```[\s\S]*?```/g, (match) => {
    const i = placeholders.push(match) - 1;
    return PLACEHOLDER(i);
  });

  // Inline code: `...`
  protectedText = protectedText.replace(/`[^`\n]*`/g, (match) => {
    const i = placeholders.push(match) - 1;
    return PLACEHOLDER(i);
  });

  // Scrub tag-looking tokens that aren't in the allowlist.
  protectedText = protectedText.replace(
    /<\/?([A-Za-z][A-Za-z0-9-]*)(\s[^>]*)?\/?>/g,
    (match, tag: string) => {
      const lower = tag.toLowerCase();
      if (HTML_ALLOWLIST.has(lower)) return match;
      // Escape the angle brackets so MDX treats this as literal text.
      return match.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
  );

  // Escape bare { and } so MDX does not evaluate them as JS expressions.
  // e.g. `{server}` or `{server: true}` in prose would cause "server is not
  // defined" at prerender time. All event bodies are upstream prose — there
  // are no intentional MDX expressions to preserve.
  protectedText = protectedText.replace(/\{/g, "\\{").replace(/\}/g, "\\}");

  // Restore protected segments.
  protectedText = protectedText.replace(
    /\u0000MDXSAFE(\d+)\u0000/g,
    (_, i: string) => placeholders[Number(i)] ?? "",
  );

  return protectedText;
}
