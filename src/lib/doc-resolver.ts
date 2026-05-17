// Server util: resolve a doc token or a code.claude.com URL to its
// `cli_reference` row, so MDX bodies and curated copy can render the rich
// DocPopover instead of a bare navigating link.
//
// One DB query builds an in-memory index, cached per process with a short TTL
// (same idiom as src/lib/current-cli.ts). Resolution is pure string work on
// the cached index — cheap enough to call once per token per render.

import { tryGetDb } from "@/lib/db";
import { cliReference } from "@/lib/db/schema";
import type { CliReference } from "@/lib/db/schema";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DOCS_HOST = "code.claude.com";

interface DocIndex {
  /** Lower-cased exact token → row (e.g. "/init", "--print", "pretooluse"). */
  byToken: Map<string, CliReference>;
  /** Lower-cased flag alias (e.g. "-p") → row. */
  byAlias: Map<string, CliReference>;
  /** docsUrl with the #anchor stripped, lower-cased → row. */
  byDocsPath: Map<string, CliReference>;
}

let cache: { index: DocIndex; expiresAt: number } | null = null;

function aliasesOf(row: CliReference): string[] {
  const raw = (row.metadata as Record<string, unknown> | null)?.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string" && a.length > 0);
}

function docsPathKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== DOCS_HOST) return null;
    return `${u.pathname}${u.hash}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function buildIndex(rows: CliReference[]): DocIndex {
  const byToken = new Map<string, CliReference>();
  const byAlias = new Map<string, CliReference>();
  const byDocsPath = new Map<string, CliReference>();

  for (const row of rows) {
    byToken.set(row.name.toLowerCase(), row);
    for (const alias of aliasesOf(row)) {
      byAlias.set(alias.toLowerCase(), row);
    }
    if (row.docsUrl) {
      const key = docsPathKey(row.docsUrl);
      if (key) byDocsPath.set(key, row);
      // Also index without the anchor so a bare page link still resolves to
      // the first matching row (best-effort; anchor match wins above).
      try {
        const u = new URL(row.docsUrl);
        const noHash = u.pathname.toLowerCase().replace(/\/+$/, "");
        if (!byDocsPath.has(noHash)) byDocsPath.set(noHash, row);
      } catch {
        // ignore malformed stored URL
      }
    }
  }

  return { byToken, byAlias, byDocsPath };
}

async function getIndex(): Promise<DocIndex | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.index;

  const db = tryGetDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(cliReference);
    const index = buildIndex(rows);
    cache = { index, expiresAt: now + CACHE_TTL_MS };
    return index;
  } catch {
    // Don't cache failures — next render retries.
    return null;
  }
}

/** Normalize an inline token: trim, drop a single pair of wrapping backticks. */
function normalizeToken(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("`") && t.endsWith("`") && t.length > 1) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Resolve a free-text token to its cli_reference row, or null.
 *
 * Handles: slash commands (`/init`), flags (`--print`) and their aliases
 * (`-p`), hook events (`PreToolUse`), and CLI subcommands. For subcommands
 * the stored name may carry placeholders (e.g. "claude stop <id>") so we also
 * try a prefix match on the leading `claude <word>` segment.
 */
export async function resolveDocToken(
  raw: string,
): Promise<CliReference | null> {
  const token = normalizeToken(raw);
  if (!token) return null;

  const index = await getIndex();
  if (!index) return null;

  const lower = token.toLowerCase();

  const exact = index.byToken.get(lower);
  if (exact) return exact;

  const alias = index.byAlias.get(lower);
  if (alias) return alias;

  // Subcommand: "claude update" — match the canonical leading segment even if
  // the stored name has trailing placeholders.
  if (/^claude\s+\S/.test(lower)) {
    const segment = lower.split(/\s+/).slice(0, 2).join(" ");
    for (const [name, row] of index.byToken) {
      if (row.kind === "cli-subcommand" && name.startsWith(segment)) {
        return row;
      }
    }
  }

  return null;
}

/** Resolve a code.claude.com docs URL to its cli_reference row, or null. */
export async function resolveDocUrl(href: string): Promise<CliReference | null> {
  const index = await getIndex();
  if (!index) return null;

  const key = docsPathKey(href);
  if (!key) return null;

  const exact = index.byDocsPath.get(key);
  if (exact) return exact;

  // Fall back to the anchorless page path.
  try {
    const u = new URL(href);
    const noHash = u.pathname.toLowerCase().replace(/\/+$/, "");
    return index.byDocsPath.get(noHash) ?? null;
  } catch {
    return null;
  }
}

/** True for a code.claude.com docs URL — used to decide whether to even try. */
export function isDocsUrl(href: string): boolean {
  try {
    return new URL(href).host === DOCS_HOST;
  } catch {
    return false;
  }
}
