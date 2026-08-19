// Scrapes code.claude.com docs for the Claude Code command/flag/hook-event
// surface and upserts into `cli_reference`. Three pages, three distinct ETags
// for independent caching. Fails loud if fewer than 20 rows parse across all
// three — a count below that means at least one page's markup broke.
//
// Deprecation is detected by `lastSeenAt` age: a row missing from the docs
// for 3+ days is flagged `deprecatedAt` (never deleted). If a deprecated row
// reappears, the flag clears on the next successful scrape.
//
// "New since" uses `firstSeenAt`. To avoid spuriously marking every row as
// new on first deploy, the very first poll backdates all inserts to a sentinel
// date. Subsequent inserts use `now()` and emit a `new_{kind}` event.

import * as cheerio from "cheerio";
import { and, count, eq, isNull, lt } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { cliReference, events, pollerRuns } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";
import { markProviderRowsStillPresent, sweepIsSafe } from "@/lib/sources/cli-reference-shared";

const SOURCE_KEY = "claude_code_reference";
const PROVIDER: Provider = "claude";
const COMMANDS_URL = "https://code.claude.com/docs/en/commands";
const CLI_REF_URL = "https://code.claude.com/docs/en/cli-reference";
const HOOKS_URL = "https://code.claude.com/docs/en/hooks";

const MIN_EXPECTED_ROWS = 20;
const DEPRECATION_STALE_DAYS = 3;
// Sentinel date pre-dating Claude Code's public launch. Used on first run only
// so nothing is spuriously labeled "new" for the first 90 days post-deploy.
const SEED_FIRST_SEEN_AT = new Date("2024-01-01T00:00:00.000Z");

type Kind = "slash" | "flag" | "cli-subcommand" | "hook-event" | "skill";

interface ParsedItem {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  usage: string | null;
  docsUrl: string;
  metadata: Record<string, unknown>;
}

function cheerioText(el: { text(): string }): string {
  return el.text().replace(/\s+/g, " ").trim();
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function parseCommandsPage(html: string): ParsedItem[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (table.length === 0) return [];
  const items: ParsedItem[] = [];
  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    const rawCmd = cheerioText($(cells[0]!));
    const purpose = cheerioText($(cells[1]!));
    // Extract the canonical token — first word that starts with `/`.
    const match = rawCmd.match(/^(\/[\w-]+)/);
    if (!match) return;
    const name = match[1]!;
    const anchor = name.replace(/^\//, "").toLowerCase();
    items.push({
      id: `slash:${name}`,
      kind: "slash",
      name,
      description: purpose || null,
      usage: rawCmd !== name ? decode(rawCmd) : null,
      docsUrl: `${COMMANDS_URL}#${anchor}`,
      metadata: {},
    });
  });
  return items;
}

function parseCliReferencePage(html: string): ParsedItem[] {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $("table").each((tableIdx, tableEl) => {
    const header = $(tableEl)
      .find("thead tr")
      .first()
      .find("th")
      .map((_, th) => cheerioText($(th)))
      .get();
    if (header.length < 2) return;
    const firstHeader = header[0]!.toLowerCase();
    const kind: Kind | null =
      firstHeader === "command" && tableIdx === 0
        ? "cli-subcommand"
        : firstHeader === "flag"
          ? "flag"
          : null;
    if (!kind) return;
    $(tableEl)
      .find("tbody tr")
      .each((_, tr) => {
        const cells = $(tr).find("td");
        if (cells.length < 2) return;
        const rawName = cheerioText($(cells[0]!));
        const description = cheerioText($(cells[1]!));
        const example = cells.length >= 3 ? cheerioText($(cells[2]!)) : null;
        // Canonical token: first flag (`--xxx`) or first `claude ...` segment.
        let name = rawName;
        if (kind === "flag") {
          const m = rawName.match(/--[\w-]+/);
          if (!m) return;
          name = m[0];
        } else {
          // subcommand — strip angle-bracket placeholders and quotes for id.
          name = decode(rawName).replace(/\s+/g, " ").trim();
        }
        const anchor = name.replace(/^[-/]+/, "").replace(/\s+/g, "-").toLowerCase();
        const metadata: Record<string, unknown> = {};
        // Additional flags mentioned in the first cell become aliases.
        if (kind === "flag") {
          const aliases = (rawName.match(/-[\w-]+/g) ?? []).filter((a) => a !== name);
          if (aliases.length > 0) metadata.aliases = aliases;
        }
        items.push({
          id: `${kind}:${name}`,
          kind,
          name,
          description: description || null,
          usage: example ? decode(example) : null,
          docsUrl: `${CLI_REF_URL}#${anchor}`,
          metadata,
        });
      });
  });
  return items;
}

function parseHooksPage(html: string): ParsedItem[] {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  // The in-page TOC renders each hook event as `<li data-depth="1"><a href="#pretooluse">PreToolUse</a></li>`.
  $('li[data-depth="1"] a[href^="#"]').each((_, el) => {
    const text = cheerioText($(el));
    // Hook events are PascalCase, no spaces, e.g. "PreToolUse", "SessionStart".
    if (!/^[A-Z][A-Za-z]+$/.test(text)) return;
    if (seen.has(text)) return;
    seen.add(text);
    const anchor = $(el).attr("href")?.slice(1) ?? text.toLowerCase();
    items.push({
      id: `hook-event:${text}`,
      kind: "hook-event",
      name: text,
      description: null,
      usage: null,
      docsUrl: `${HOOKS_URL}#${anchor}`,
      metadata: {},
    });
  });
  return items;
}

export async function runClaudeCodeReference(): Promise<RunResult> {
  const [cmdRes, cliRes, hooksRes] = await Promise.all([
    fetchConditional(COMMANDS_URL, `${SOURCE_KEY}_commands`),
    fetchConditional(CLI_REF_URL, `${SOURCE_KEY}_flags`),
    fetchConditional(HOOKS_URL, `${SOURCE_KEY}_hooks`),
  ]);

  for (const [label, res] of [
    ["commands", cmdRes],
    ["flags", cliRes],
    ["hooks", hooksRes],
  ] as const) {
    if (!res.body && !res.unchanged) {
      throw new Error(`cli_reference: ${label} page returned status ${res.status}`);
    }
  }

  const parsed: ParsedItem[] = [
    ...(cmdRes.body ? parseCommandsPage(cmdRes.body) : []),
    ...(cliRes.body ? parseCliReferencePage(cliRes.body) : []),
    ...(hooksRes.body ? parseHooksPage(hooksRes.body) : []),
  ];

  // If all three ETag'd unchanged, we still want to refresh lastSeenAt — so only
  // fail-loud when we actually have bodies and still parsed nothing.
  const anyBody = Boolean(cmdRes.body || cliRes.body || hooksRes.body);
  if (anyBody && parsed.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `cli_reference: parsed only ${parsed.length} rows from the docs pages (< ${MIN_EXPECTED_ROWS}); markup likely changed`,
    );
  }

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  // Detect first run so we can backdate firstSeenAt rather than mark every row new.
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
      .select({ id: cliReference.id, deprecatedAt: cliReference.deprecatedAt })
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
          // Keep id/kind/firstSeenAt immutable; refresh everything else.
          name: item.name,
          description: item.description,
          usage: item.usage,
          docsUrl: item.docsUrl,
          metadata: item.metadata,
          lastSeenAt: now,
          // If a row was deprecated but is back in the docs, clear the flag.
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

  // Deprecation sweep — rows not touched for 3+ days that aren't already marked.
  //
  // MUST be scoped to this source's provider. Unscoped, this statement reached
  // EVERY cli_reference row: it marked all 481 OpenAI and all 40 Gemini rows
  // deprecated (they go stale whenever their own source is failing or 304ing),
  // which hid every one of them from the site, because the provider pages filter
  // on `deprecated_at is null`. The OpenAI and Gemini reference sources have
  // always scoped their sweeps; this one predates the multi-provider split and
  // was never retrofitted.
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
      bodyMd: `\`${row.name}\` is no longer listed in the Claude Code docs.`,
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

export const claudeCodeReferenceSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runClaudeCodeReference,
};
