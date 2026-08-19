// Scrapes the OpenAI Codex CLI reference docs and upserts into `cli_reference`.
//
// The docs are served as raw markdown that embeds JS object-literal arrays:
//   reference.md:        `export const globalFlagOptions = [ {key,type,description,...}, ... ];`
//   config-reference.md: `<ConfigTable options={[ {key,type,description}, ... ]} />`
//
// We do NOT eval the literals (untrusted upstream, unquoted keys, backticks in
// descriptions). Instead we locate each array block by bracket-balancing, then
// pull `{ ... }` records and read key/type/description/defaultValue via tolerant
// regexes. Anything that doesn't match is skipped rather than throwing — a
// formatting change degrades coverage instead of breaking the poller.
//
// id-namespacing: existing Claude cli_reference rows use the bare PK
// `"{kind}:{name}"`. To avoid a cross-provider PK collision (and without
// migrating Claude rows this phase), OpenAI/Gemini rows use a
// provider-namespaced id `"{provider}:{kind}:{name}"`. The asymmetry is
// intentional and normalized in a later phase. The `provider` column is always
// set regardless.
//
// config-reference.md is best-effort: if its <ConfigTable> block can't be
// located or parses to zero records we log and skip it — it must not block the
// phase. The flags page (reference.md) is the load-bearing source.

import * as cheerio from "cheerio";
import { and, count, eq, isNull, lt } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { cliReference, events, pollerRuns } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";
import { markProviderRowsStillPresent, sweepIsSafe } from "@/lib/sources/cli-reference-shared";

const SOURCE_KEY = "openai_codex_reference";
const PROVIDER: Provider = "openai";
// 2026-08: OpenAI moved the Codex docs to learn.chatgpt.com and stopped shipping
// the option arrays inside the `.md` payload — the old
// developers.openai.com/codex/cli/reference.md now 308s to a markdown file whose
// tables are `<ConfigTable client:load options={globalFlagOptions} />` references
// with no literal to parse, which is why this source reported "parsed only 0
// flags" on every run. The data lives in the RENDERED page, serialized into
// `<astro-island props="...">` attributes, so we read the HTML now.
const REFERENCE_URL = "https://learn.chatgpt.com/docs/developer-commands?surface=cli";
const CONFIG_REFERENCE_URL = "https://learn.chatgpt.com/docs/config-file/config-reference";
const REFERENCE_DOCS_URL = "https://learn.chatgpt.com/docs/developer-commands";
const CONFIG_DOCS_URL = "https://learn.chatgpt.com/docs/config-file/config-reference";

// Calibrated against the Phase 2.2 live run (~94 flags parsed from
// reference.md). 15 is a deliberately loose floor: anything under it means the
// embedded JS array structure changed and we'd rather error than half-ingest.
const MIN_EXPECTED_ROWS = 15;
const DEPRECATION_STALE_DAYS = 3;
// Sentinel pre-dating Codex CLI's public launch — used on first run only so
// nothing is spuriously labeled "new" on initial deploy.
const SEED_FIRST_SEEN_AT = new Date("2024-01-01T00:00:00.000Z");

type Kind = "flag" | "config-key";

interface ParsedItem {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  usage: string | null;
  docsUrl: string;
  metadata: Record<string, unknown>;
}

interface LiteralRecord {
  key?: string;
  type?: string;
  description?: string;
  defaultValue?: string;
}

/**
 * Find the array body for a `<prefix>[ ... ]` construct starting at `from`.
 * Returns the inner text between the matching brackets (bracket-balanced so
 * nested `[...]` in descriptions don't terminate early), or null.
 */
function extractArrayBlock(src: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Split an array body into top-level `{ ... }` record substrings. */
function splitRecords(body: string): string[] {
  const records: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        records.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return records;
}

/** Read a string-valued field from a record literal, tolerating ', ", or `. */
function readField(record: string, field: string): string | undefined {
  // field: "..."  |  field: '...'  |  field: `...`  — value may contain escaped
  // quotes of the same kind; we stop at the first unescaped matching quote.
  const re = new RegExp(`\\b${field}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1`);
  const m = record.match(re);
  if (!m) return undefined;
  return m[2]!
    .replace(/\\(["'`\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRecords(body: string): LiteralRecord[] {
  return splitRecords(body)
    .map(
      (r): LiteralRecord => ({
        key: readField(r, "key"),
        type: readField(r, "type"),
        description: readField(r, "description"),
        defaultValue: readField(r, "defaultValue"),
      }),
    )
    .filter((r): r is LiteralRecord & { key: string } => Boolean(r.key));
}

/**
 * Astro serializes island props as `[typeTag, value]` tuples: 0 = raw value,
 * 1 = array. Anything else is passed through unchanged — we only need the two
 * shapes the docs' ConfigTable uses, and an unknown tag degrades to "no rows"
 * rather than throwing.
 */
function decodeAstroProp(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
    const [tag, inner] = value as [number, unknown];
    if (tag === 1 && Array.isArray(inner)) return inner.map(decodeAstroProp);
    if (inner !== null && typeof inner === "object") return decodeAstroProp(inner);
    return inner;
  }
  if (Array.isArray(value)) return value.map(decodeAstroProp);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, decodeAstroProp(v)]),
    );
  }
  return value;
}

/**
 * Pull every ConfigTable row out of a rendered learn.chatgpt.com page.
 *
 * The page also renders non-table islands that happen to carry an `options`
 * prop (the mobile nav tabs are `{value,label}` pairs), so we keep only records
 * with a non-empty string `key` — the shape every real option row has.
 */
function parseAstroIslandOptions(htmlSrc: string): LiteralRecord[] {
  const $ = cheerio.load(htmlSrc);
  const out: LiteralRecord[] = [];

  $("astro-island[props]").each((_, el) => {
    const raw = $(el).attr("props");
    if (!raw) return;
    let parsed: unknown;
    try {
      // cheerio has already decoded the HTML entities in the attribute value.
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;
    const optionsProp = (parsed as Record<string, unknown>).options;
    if (optionsProp === undefined) return;

    const rows = decodeAstroProp(optionsProp);
    if (!Array.isArray(rows)) return;

    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (typeof rec.key !== "string" || rec.key.trim() === "") continue;
      out.push({
        key: rec.key.trim(),
        type: typeof rec.type === "string" ? rec.type : undefined,
        description:
          typeof rec.description === "string"
            ? rec.description.replace(/\s+/g, " ").trim()
            : undefined,
        defaultValue: typeof rec.defaultValue === "string" ? rec.defaultValue : undefined,
      });
    }
  });

  return out;
}

/** Map parsed option records onto flag rows (aliases split off the key). */
function toFlagItems(records: LiteralRecord[]): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    // A record's `key` may list aliases: "--image, -i" or "codex resume".
    const aliases = rec
      .key!.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const name = aliases[0]!;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const metadata: Record<string, unknown> = {};
    if (aliases.length > 1) metadata.aliases = aliases.slice(1);
    if (rec.type) metadata.valueType = rec.type;
    if (rec.defaultValue !== undefined) metadata.default = rec.defaultValue;
    items.push({
      id: `${PROVIDER}:flag:${name}`,
      kind: "flag",
      name,
      description: rec.description ?? null,
      usage: rec.type ? `${name} <${rec.type}>` : null,
      docsUrl: REFERENCE_DOCS_URL,
      metadata,
    });
  }
  return items;
}

/** Map parsed option records onto config-key rows. */
function toConfigItems(records: LiteralRecord[]): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const name = rec.key!;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const metadata: Record<string, unknown> = {};
    if (rec.type) metadata.valueType = rec.type;
    if (rec.defaultValue !== undefined) metadata.default = rec.defaultValue;
    items.push({
      id: `${PROVIDER}:config-key:${name}`,
      kind: "config-key",
      name,
      description: rec.description ?? null,
      usage: rec.type ? `${name} = <${rec.type}>` : null,
      docsUrl: CONFIG_DOCS_URL,
      metadata,
    });
  }
  return items;
}

/**
 * reference.md: every `export const NAME = [ ... ];`. We treat array members
 * whose NAME ends in "Options" or "Flags" as flag-like records; "Commands"/
 * "Overview" arrays are subcommands. Both land as kind "flag" with a usage
 * snippet — the page itself doesn't separate them into distinct doc anchors.
 */
function parseReferenceMd(md: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  const re = /export\s+const\s+(\w+)\s*=\s*\[/g;
  while (re.exec(md)) {
    // Intentionally do NOT advance re.lastIndex past the extracted block: a
    // nested `export const ... = [` inside this block (or the regex resuming
    // mid-block) can re-yield records we already emitted. That's fine — the
    // `seen` set dedupes by name, so re-scanning is harmless and keeps this
    // simpler than tracking block end offsets.
    const block = extractArrayBlock(md, re.lastIndex - 1);
    if (!block) continue;
    for (const rec of parseRecords(block)) {
      const rawKey = rec.key!;
      // A record's `key` may list aliases: "--image, -i" or "codex resume".
      const aliases = rawKey
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const name = aliases[0]!;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const metadata: Record<string, unknown> = {};
      if (aliases.length > 1) metadata.aliases = aliases.slice(1);
      if (rec.type) metadata.valueType = rec.type;
      if (rec.defaultValue !== undefined) metadata.default = rec.defaultValue;
      items.push({
        id: `${PROVIDER}:flag:${name}`,
        kind: "flag",
        name,
        description: rec.description ?? null,
        usage: rec.type ? `${name} <${rec.type}>` : null,
        docsUrl: "https://developers.openai.com/codex/cli/reference",
        metadata,
      });
    }
  }
  return items;
}

/**
 * config-reference.md: `<ConfigTable options={[ ... ]} />`. Best-effort — if no
 * block parses, callers log and continue (this page is non-blocking).
 */
function parseConfigReferenceMd(md: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  const re = /options\s*=\s*\{?\s*\[/g;
  while (re.exec(md)) {
    // Position the bracket-balancer at the `[` the regex just consumed.
    const block = extractArrayBlock(md, re.lastIndex - 1);
    if (!block) continue;
    for (const rec of parseRecords(block)) {
      const name = rec.key!;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const metadata: Record<string, unknown> = {};
      if (rec.type) metadata.valueType = rec.type;
      if (rec.defaultValue !== undefined) metadata.default = rec.defaultValue;
      items.push({
        id: `${PROVIDER}:config-key:${name}`,
        kind: "config-key",
        name,
        description: rec.description ?? null,
        usage: rec.type ? `${name} = <${rec.type}>` : null,
        docsUrl: "https://developers.openai.com/codex/config-reference",
        metadata,
      });
    }
  }
  return items;
}

export async function runOpenaiCodexReference(): Promise<RunResult> {
  const [refRes, cfgRes] = await Promise.all([
    fetchConditional(REFERENCE_URL, `${SOURCE_KEY}_reference`),
    fetchConditional(CONFIG_REFERENCE_URL, `${SOURCE_KEY}_config`),
  ]);

  // The commands reference is load-bearing — a hard failure there is a real error.
  if (!refRes.body && !refRes.unchanged) {
    throw new Error(`codex developer-commands page returned status ${refRes.status}`);
  }

  // Primary path: the rendered page's astro-island props. Fallback: the legacy
  // `export const NAME = [...]` literals, kept so an upstream revert (or a
  // mirror that still ships them) keeps working instead of erroring.
  const flags = refRes.body
    ? (() => {
        const fromIslands = toFlagItems(parseAstroIslandOptions(refRes.body));
        if (fromIslands.length > 0) return fromIslands;
        // eslint-disable-next-line no-console
        console.warn(
          `[${SOURCE_KEY}] no astro-island option tables found — falling back to legacy literal parsing`,
        );
        return parseReferenceMd(refRes.body);
      })()
    : [];

  // The config reference is best-effort and must not block the phase.
  let configKeys: ParsedItem[] = [];
  if (cfgRes.body) {
    try {
      configKeys = toConfigItems(parseAstroIslandOptions(cfgRes.body));
      if (configKeys.length === 0) configKeys = parseConfigReferenceMd(cfgRes.body);
      if (configKeys.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(`[${SOURCE_KEY}] config reference parsed 0 keys — structure unclear, skipping`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[${SOURCE_KEY}] config reference parse failed, skipping:`,
        err instanceof Error ? err.message : String(err),
      );
      configKeys = [];
    }
  } else if (!cfgRes.unchanged) {
    // eslint-disable-next-line no-console
    console.warn(`[${SOURCE_KEY}] config reference returned status ${cfgRes.status} — skipping`);
  }

  const parsed = [...flags, ...configKeys];

  const anyBody = Boolean(refRes.body || cfgRes.body);
  if (anyBody && flags.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `${SOURCE_KEY}: parsed only ${flags.length} flags from ${REFERENCE_URL} (< ${MIN_EXPECTED_ROWS}); markup likely changed`,
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
        docsUrl: item.docsUrl,
        metadata: item.metadata,
        firstSeenAt: firstSeenForNewRows,
        lastSeenAt: now,
        provider: PROVIDER,
      });
      inserted++;

      if (!isFirstRun) {
        // Idempotent: this `events` row survives even if its cli_reference/doc row is
        // later removed and re-added, so without this the whole run threw on a unique
        // (source, external_id) violation and lost every later item.
        await db.insert(events).values({
          source: SOURCE_KEY,
          type: `new_${item.kind}`,
          externalId: item.id,
          title: `New ${item.kind}: ${item.name}`,
          bodyMd:
            `\`${item.name}\`${item.description ? ` — ${item.description}` : ""}` +
            (item.usage ? `\n\n\`\`\`\n${item.usage}\n\`\`\`` : ""),
          url: item.docsUrl,
          publishedAt: now,
          provider: PROVIDER,
        })
        .onConflictDoNothing({ target: [events.source, events.externalId] });
      }
    } else {
      await db
        .update(cliReference)
        .set({
          name: item.name,
          description: item.description,
          usage: item.usage,
          docsUrl: item.docsUrl,
          metadata: item.metadata,
          lastSeenAt: now,
          deprecatedAt: null,
        })
        .where(eq(cliReference.id, item.id));
      updated++;
    }
  }

  // Never deprecate on a run that parsed nothing (all-304, or an upstream that
  // went quiet) — "we saw no items" is not evidence that items disappeared.
  // A 304 additionally means every row we hold is still present upstream, so
  // refresh them and clear any deprecation an earlier defect left behind.
  if (!sweepIsSafe(parsed.length)) {
    await markProviderRowsStillPresent(db, PROVIDER, now);
    return { inserted, updated, skipped: 0, status: "ok" };
  }

  // Deprecation sweep — scoped to this source's PROVIDER, not this SOURCE_KEY.
  // A row of ours not refreshed for 3+ days is presumed gone.
  //
  // SAFE TODAY ONLY because there is exactly one cli_reference source per
  // provider (openai_codex_reference is the sole "openai" cli_reference writer).
  // If a second same-provider cli_reference source is ever added, this sweep
  // would deprecate the *other* source's rows on every run (they share the
  // provider but are refreshed by a different SOURCE_KEY). Before adding one,
  // re-scope this to be source-aware (e.g. track lastSeenAt per source, or add
  // a source column predicate) — provider-scoping alone is not sufficient then.
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
    // Idempotent: this `events` row survives even if its cli_reference/doc row is
    // later removed and re-added, so without this the whole run threw on a unique
    // (source, external_id) violation and lost every later item.
    await db.insert(events).values({
      source: SOURCE_KEY,
      type: `deprecated_${row.kind}`,
      externalId: `deprecated:${row.id}`,
      title: `Deprecated ${row.kind}: ${row.name}`,
      bodyMd: `\`${row.name}\` is no longer listed in the Codex CLI docs.`,
      url: null,
      publishedAt: now,
      provider: PROVIDER,
    })
    .onConflictDoNothing({ target: [events.source, events.externalId] });
  }

  return {
    inserted,
    updated: updated + newlyDeprecated.length,
    skipped: 0,
    status: "ok",
  };
}

export const openaiCodexReferenceSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runOpenaiCodexReference,
};
