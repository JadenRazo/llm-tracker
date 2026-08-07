// Scrapes the Gemini CLI reference (docs/cli/cli-reference.md) and upserts into
// `cli_reference`. The doc is raw markdown with pipe tables:
//   | Command | Description | Example |          -> kind "cli-subcommand"
//   | Command | Description |                      -> kind "slash" (REPL `/cmds`)
//   | Option  | Alias | Type | Default | Desc |   -> kind "flag"
// We classify each table by its header row and skip tables we don't recognise.
// Parsing is defensive: a structural change degrades coverage and trips the
// MIN_EXPECTED_ROWS guard rather than corrupting rows.
//
// id-namespacing: Claude cli_reference rows use the bare PK "{kind}:{name}".
// To avoid a cross-provider PK collision (without migrating Claude rows this
// phase), Gemini rows use "{provider}:{kind}:{name}". Asymmetry is intentional
// and normalized in a later phase. `provider` column is always set.

import { and, count, eq, isNull, lt } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { cliReference, events, pollerRuns } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "gemini_cli_reference";
const PROVIDER: Provider = "gemini";
const REFERENCE_URL =
  "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/cli-reference.md";
const DOCS_URL =
  "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md";

// Calibrated against the Phase 2.2 live run (~40 rows parsed from
// cli-reference.md). 15 is a deliberately loose floor: anything under it means
// the markdown structure changed and we'd rather error than half-ingest.
const MIN_EXPECTED_ROWS = 15;
const DEPRECATION_STALE_DAYS = 3;
const SEED_FIRST_SEEN_AT = new Date("2024-01-01T00:00:00.000Z");

type Kind = "slash" | "flag" | "cli-subcommand";

interface ParsedItem {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  usage: string | null;
  metadata: Record<string, unknown>;
}

interface MdTable {
  header: string[];
  rows: string[][];
}

/** Split a markdown body into pipe-tables (header + body rows). */
function parseTables(md: string): MdTable[] {
  const lines = md.split(/\r?\n/);
  const tables: MdTable[] = [];
  let i = 0;
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      // Split on unescaped pipes (cell contents may contain `\|`).
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, "|").trim());

  while (i < lines.length) {
    if (isRow(lines[i]!) && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      const header = cells(lines[i]!);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i]!) && !isSep(lines[i]!)) {
        rows.push(cells(lines[i]!));
        i++;
      }
      tables.push({ header, rows });
    } else {
      i++;
    }
  }
  return tables;
}

/** Strip markdown inline code/bold and angle placeholders for a clean token. */
function cleanToken(raw: string): string {
  return raw
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}

// Failure mode to be aware of: the slash branch keys off a 2-column
// `| Command | Description |` header. If upstream ever widens that REPL table
// (adds an Example/Alias column) it stops matching `h.length === 2` and falls
// through to `return null` — those slash rows silently vanish from coverage
// rather than misclassifying. Conversely a 2-col table that *isn't* slash
// commands would be misread as slash. Both are acceptable (degrade, don't
// corrupt) but a coverage drop here usually means this header shape changed.
function classify(header: string[]): Kind | null {
  const h = header.map((c) => c.toLowerCase().trim());
  if (h[0] === "option") return "flag";
  if (h[0] === "command" && h.includes("example")) return "cli-subcommand";
  // Interactive REPL slash-command table: `| Command | Description |`.
  if (h[0] === "command" && h.length === 2) return "slash";
  return null;
}

function parseReference(md: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  for (const table of parseTables(md)) {
    const kind = classify(table.header);
    if (!kind) continue;
    const h = table.header.map((c) => c.toLowerCase().trim());
    const descIdx = h.findIndex((c) => c === "description");
    const exIdx = h.findIndex((c) => c === "example");
    const aliasIdx = h.findIndex((c) => c === "alias");
    const typeIdx = h.findIndex((c) => c === "type");
    const defIdx = h.findIndex((c) => c === "default");

    for (const row of table.rows) {
      if (row.length < 1) continue;
      const rawName = cleanToken(row[0] ?? "");
      if (!rawName) continue;

      let name = rawName;
      if (kind === "flag") {
        const m = rawName.match(/--[\w-]+/);
        if (!m) continue;
        name = m[0];
      } else if (kind === "slash") {
        const m = rawName.match(/\/[\w-]+/);
        if (!m) continue;
        name = m[0];
      } else {
        // cli-subcommand — first word after "gemini", else first token.
        const m = rawName.match(/^gemini\s+([\w-]+)/);
        name = m ? `gemini ${m[1]}` : rawName.split(/\s+/)[0]!;
      }
      if (!name || seen.has(`${kind}:${name}`)) continue;
      seen.add(`${kind}:${name}`);

      const description = descIdx >= 0 ? cleanToken(row[descIdx] ?? "") || null : null;
      const example = exIdx >= 0 ? cleanToken(row[exIdx] ?? "") || null : null;
      const metadata: Record<string, unknown> = {};
      if (aliasIdx >= 0) {
        const alias = cleanToken(row[aliasIdx] ?? "").replace(/^-+/, "-");
        if (alias && alias !== "-" && alias !== "") metadata.aliases = [alias];
      }
      if (typeIdx >= 0) {
        const t = cleanToken(row[typeIdx] ?? "");
        if (t && t !== "-") metadata.valueType = t;
      }
      if (defIdx >= 0) {
        const d = cleanToken(row[defIdx] ?? "");
        if (d && d !== "-") metadata.default = d;
      }

      items.push({
        id: `${PROVIDER}:${kind}:${name}`,
        kind,
        name,
        description,
        usage: example ?? (kind === "cli-subcommand" ? rawName : null),
        metadata,
      });
    }
  }
  return items;
}

export async function runGeminiCliReference(): Promise<RunResult> {
  const res = await fetchConditional(REFERENCE_URL, SOURCE_KEY);

  if (res.unchanged) {
    return { inserted: 0, updated: 0, skipped: 0, status: "unchanged", etag: res.etag, lastModified: res.lastModified };
  }
  if (!res.body || res.status >= 400) {
    throw new Error(`Gemini CLI reference returned status ${res.status}`);
  }

  const parsed = parseReference(res.body);
  // Unconditional throw on a short parse is safe ONLY because this source is a
  // single page fetched in one request (no pagination): a non-unchanged 200
  // here means we have the whole document, so a low row count genuinely means
  // the markup changed. If this ever became multi-page, a short final page
  // would spuriously trip this — re-scope the guard before paginating.
  if (parsed.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `${SOURCE_KEY}: parsed only ${parsed.length} rows (< ${MIN_EXPECTED_ROWS}); cli-reference.md markup likely changed`,
    );
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const runCount = await db
    .select({ c: count() })
    .from(pollerRuns)
    .where(eq(pollerRuns.source, SOURCE_KEY));
  const isFirstRun = (runCount[0]?.c ?? 0) === 0;
  const now = new Date();
  const firstSeenForNewRows = isFirstRun ? SEED_FIRST_SEEN_AT : now;

  let inserted = 0;
  let updated = 0;

  for (const item of parsed) {
    const existing = await db
      .select({ id: cliReference.id })
      .from(cliReference)
      .where(eq(cliReference.id, item.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(cliReference).values({
        id: item.id,
        kind: item.kind,
        name: item.name,
        description: item.description,
        usage: item.usage,
        docsUrl: DOCS_URL,
        metadata: item.metadata,
        firstSeenAt: firstSeenForNewRows,
        lastSeenAt: now,
        provider: PROVIDER,
      });
      inserted++;

      if (!isFirstRun) {
        await db.insert(events).values({
          source: SOURCE_KEY,
          type: `new_${item.kind}`,
          externalId: item.id,
          title: `New ${item.kind}: ${item.name}`,
          bodyMd:
            `\`${item.name}\`${item.description ? ` — ${item.description}` : ""}` +
            (item.usage ? `\n\n\`\`\`\n${item.usage}\n\`\`\`` : ""),
          url: DOCS_URL,
          publishedAt: now,
          provider: PROVIDER,
        });
      }
    } else {
      await db
        .update(cliReference)
        .set({
          name: item.name,
          description: item.description,
          usage: item.usage,
          docsUrl: DOCS_URL,
          metadata: item.metadata,
          lastSeenAt: now,
          deprecatedAt: null,
        })
        .where(eq(cliReference.id, item.id));
      updated++;
    }
  }

  // Deprecation sweep — scoped to this source's PROVIDER, not this SOURCE_KEY;
  // never touches Claude rows.
  //
  // SAFE TODAY ONLY because there is exactly one cli_reference source per
  // provider (gemini_cli_reference is the sole "gemini" cli_reference writer).
  // If a second same-provider cli_reference source is ever added, this sweep
  // would deprecate the *other* source's rows on every run (same provider,
  // different SOURCE_KEY refreshing lastSeenAt). Before adding one, re-scope
  // this to be source-aware — provider-scoping alone is not sufficient then.
  const threeDaysAgo = new Date(now.getTime() - DEPRECATION_STALE_DAYS * 24 * 60 * 60 * 1000);
  const newlyDeprecated = await db
    .update(cliReference)
    .set({ deprecatedAt: now })
    .where(
      and(
        eq(cliReference.provider, PROVIDER),
        lt(cliReference.lastSeenAt, threeDaysAgo),
        isNull(cliReference.deprecatedAt),
      ),
    )
    .returning({ id: cliReference.id, kind: cliReference.kind, name: cliReference.name });

  for (const row of newlyDeprecated) {
    await db.insert(events).values({
      source: SOURCE_KEY,
      type: `deprecated_${row.kind}`,
      externalId: `deprecated:${row.id}`,
      title: `Deprecated ${row.kind}: ${row.name}`,
      bodyMd: `\`${row.name}\` is no longer listed in the Gemini CLI docs.`,
      url: null,
      publishedAt: now,
      provider: PROVIDER,
    });
  }

  return {
    inserted,
    updated: updated + newlyDeprecated.length,
    skipped: 0,
    status: "ok",
    etag: res.etag,
    lastModified: res.lastModified,
  };
}

export const geminiCliReferenceSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runGeminiCliReference,
};
