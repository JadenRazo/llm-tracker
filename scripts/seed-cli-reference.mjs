// Dev/local seed for `cli_reference` so the command grid (and every doc
// popover wired off it) renders without waiting on the live pollers.
//
// Run:  npm run db:seed
// (which is `node --env-file=.env scripts/seed-cli-reference.mjs`)
//
// Idempotent: every row is upserted by primary key. Existing poller-written
// rows are left structurally intact — we only fill content fields and never
// clear `first_seen_at`, matching the scraper's update semantics in
// src/lib/sources/claude_code_reference.ts. Re-running is safe.
//
// The fixture mirrors the parser output shape of
// src/lib/sources/claude_code_reference.ts (id "{kind}:{name}", docsUrl
// anchors against code.claude.com, metadata.aliases for flags, etc.) and
// covers every kind, including a skill and one deprecated row.

import { Pool } from "pg";

const COMMANDS_URL = "https://code.claude.com/docs/en/commands";
const CLI_REF_URL = "https://code.claude.com/docs/en/cli-reference";
const HOOKS_URL = "https://code.claude.com/docs/en/hooks";
const SKILLS_URL = "https://code.claude.com/docs/en/skills";

/** Backdated so seeded rows are not spuriously flagged "New" in the grid
 *  (the grid's freshness threshold is 90 days). Matches the scraper's
 *  SEED_FIRST_SEEN_AT sentinel intent. */
const SEED_FIRST_SEEN_AT = new Date("2024-01-01T00:00:00.000Z");

/**
 * @typedef {Object} SeedRow
 * @property {"slash"|"flag"|"cli-subcommand"|"hook-event"|"skill"} kind
 * @property {string} name
 * @property {string|null} description
 * @property {string|null} usage
 * @property {string} docsUrl
 * @property {Record<string, unknown>} metadata
 * @property {boolean} [deprecated]
 */

function slashAnchor(name) {
  return name.replace(/^\//, "").toLowerCase();
}

/** @type {SeedRow[]} */
const ROWS = [
  // --- slash commands ---
  {
    kind: "slash",
    name: "/init",
    description:
      "Bootstrap a CLAUDE.md for the current project by analyzing the codebase — build commands, conventions, and architecture — so future sessions start with shared context.",
    usage: "/init",
    docsUrl: `${COMMANDS_URL}#init`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/scroll-speed",
    description:
      "Adjust mouse-wheel scroll speed interactively, with a live ruler you can scroll while the dialog is open to preview the change. Fullscreen rendering only; unavailable in the JetBrains IDE terminal.",
    usage: "/scroll-speed",
    docsUrl: `${COMMANDS_URL}#scroll-speed`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/clear",
    description:
      "Clear the current conversation context. Use it between unrelated tasks so stale context does not bias the next answer or burn tokens.",
    usage: "/clear",
    docsUrl: `${COMMANDS_URL}#clear`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/compact",
    description:
      "Summarize and compress the conversation so far into a compact form, freeing context window while preserving the salient decisions.",
    usage: "/compact [instructions]",
    docsUrl: `${COMMANDS_URL}#compact`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/agents",
    description:
      "List, create, and manage subagents available to the current project, including their tools and model assignment.",
    usage: "/agents",
    docsUrl: `${COMMANDS_URL}#agents`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/review",
    description:
      "Run a structured code review over the pending changes on the current branch and surface issues before you open a PR.",
    usage: "/review",
    docsUrl: `${COMMANDS_URL}#review`,
    metadata: {},
  },
  {
    kind: "slash",
    name: "/model",
    description:
      "Show or switch the model used for the current session (e.g. Opus, Sonnet, Haiku) without restarting Claude Code.",
    usage: "/model [model-name]",
    docsUrl: `${COMMANDS_URL}#model`,
    metadata: {},
  },
  {
    // Deprecated example — still rendered, struck-through, with a "Deprecated" badge.
    kind: "slash",
    name: "/vibe",
    description:
      "Legacy experimental command removed from the Claude Code docs. Kept here as a deprecation example so the tracker proves it flags removed surface instead of silently dropping it.",
    usage: "/vibe",
    docsUrl: `${COMMANDS_URL}#vibe`,
    metadata: {},
    deprecated: true,
  },

  // --- flags ---
  {
    kind: "flag",
    name: "--print",
    description:
      "Run a single prompt non-interactively and print the result to stdout, then exit. The building block for scripting Claude Code in pipelines and CI.",
    usage: 'claude --print "summarize the diff"',
    docsUrl: `${CLI_REF_URL}#print`,
    metadata: { aliases: ["-p"], takesValue: false },
  },
  {
    kind: "flag",
    name: "--verbose",
    description:
      "Emit full turn-by-turn output including tool calls and intermediate reasoning. Useful for debugging agent behavior and prompt issues.",
    usage: "claude --verbose",
    docsUrl: `${CLI_REF_URL}#verbose`,
    metadata: { aliases: ["-v", "-d"], takesValue: false },
  },
  {
    kind: "flag",
    name: "--model",
    description:
      "Select the model for this invocation, overriding the configured default. Accepts an alias (sonnet, opus, haiku) or a full model id.",
    usage: "claude --model opus",
    docsUrl: `${CLI_REF_URL}#model`,
    metadata: { takesValue: true },
  },
  {
    kind: "flag",
    name: "--output-format",
    description:
      "Choose the output shape in --print mode: text, json, or stream-json. json is what you parse from CI; stream-json gives incremental events.",
    usage: 'claude --print --output-format json "list files"',
    docsUrl: `${CLI_REF_URL}#output-format`,
    metadata: { takesValue: true },
  },
  {
    kind: "flag",
    name: "--continue",
    description:
      "Resume the most recent conversation in the current directory instead of starting fresh, preserving its context.",
    usage: "claude --continue",
    docsUrl: `${CLI_REF_URL}#continue`,
    metadata: { aliases: ["-c"], takesValue: false },
  },
  {
    kind: "flag",
    name: "--permission-mode",
    description:
      "Set how Claude Code asks before tool use: default, acceptEdits, plan, or bypassPermissions. Controls the autonomy/safety trade-off.",
    usage: "claude --permission-mode plan",
    docsUrl: `${CLI_REF_URL}#permission-mode`,
    metadata: { takesValue: true },
  },

  // --- cli subcommands ---
  {
    kind: "cli-subcommand",
    name: "claude update",
    description:
      "Update the Claude Code CLI in place to the latest published version using the native installer.",
    usage: "claude update",
    docsUrl: `${CLI_REF_URL}#claude-update`,
    metadata: {},
  },
  {
    kind: "cli-subcommand",
    name: "claude mcp",
    description:
      "Manage Model Context Protocol servers — add, list, remove, and inspect MCP server configurations for the current scope.",
    usage: "claude mcp add <name> <command>",
    docsUrl: `${CLI_REF_URL}#claude-mcp`,
    metadata: {},
  },
  {
    kind: "cli-subcommand",
    name: "claude config",
    description:
      "Read or write Claude Code configuration values (settings.json) from the command line without opening an editor.",
    usage: "claude config set <key> <value>",
    docsUrl: `${CLI_REF_URL}#claude-config`,
    metadata: {},
  },
  {
    kind: "cli-subcommand",
    name: "claude doctor",
    description:
      "Diagnose the local install — version, auth, MCP connectivity, and environment — and report anything misconfigured.",
    usage: "claude doctor",
    docsUrl: `${CLI_REF_URL}#claude-doctor`,
    metadata: {},
  },

  // --- hook events ---
  {
    kind: "hook-event",
    name: "PreToolUse",
    description:
      "Fires before Claude Code executes a tool call. A PreToolUse hook can inspect the proposed call and block it (non-zero exit) to enforce policy.",
    usage: null,
    docsUrl: `${HOOKS_URL}#pretooluse`,
    metadata: { canBlock: true },
  },
  {
    kind: "hook-event",
    name: "PostToolUse",
    description:
      "Fires after a tool call completes. Use it for logging, side-effects, or post-processing of tool output.",
    usage: null,
    docsUrl: `${HOOKS_URL}#posttooluse`,
    metadata: { canBlock: false },
  },
  {
    kind: "hook-event",
    name: "SessionStart",
    description:
      "Fires when a Claude Code session begins. Common use: inject project- or machine-specific context into the system prompt.",
    usage: null,
    docsUrl: `${HOOKS_URL}#sessionstart`,
    metadata: { canBlock: false },
  },
  {
    kind: "hook-event",
    name: "Stop",
    description:
      "Fires when Claude finishes responding. Use it to run validation, formatters, or to gate the turn from completing.",
    usage: null,
    docsUrl: `${HOOKS_URL}#stop`,
    metadata: { canBlock: true },
  },

  // --- skills ---
  {
    kind: "skill",
    name: "pdf",
    description:
      "Built-in skill for reading, extracting, and reasoning over PDF documents. Invoked automatically when a task involves PDF input.",
    usage: null,
    docsUrl: `${SKILLS_URL}#pdf`,
    metadata: {},
  },
  {
    kind: "skill",
    name: "xlsx",
    description:
      "Built-in skill for working with spreadsheets — reading cells, computing, and writing back .xlsx files without leaving the session.",
    usage: null,
    docsUrl: `${SKILLS_URL}#xlsx`,
    metadata: {},
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a local Postgres, then re-run `npm run db:seed`.",
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(
      `Could not connect to Postgres at the configured DATABASE_URL: ${
        err instanceof Error ? err.message : String(err)
      }\nStart your local Postgres (or fix DATABASE_URL in .env) and re-run \`npm run db:seed\`.`,
    );
    await pool.end();
    process.exit(1);
  }

  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const row of ROWS) {
    const id = `${row.kind}:${row.name}`;
    const deprecatedAt = row.deprecated ? now : null;
    // Upsert by primary key. On conflict we refresh content + lastSeenAt but
    // never touch first_seen_at — identical to the scraper's update path so a
    // later real poll stays consistent.
    const result = await pool.query(
      `INSERT INTO cli_reference
         (id, kind, name, description, usage, docs_url, metadata,
          first_seen_at, last_seen_at, deprecated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         usage = EXCLUDED.usage,
         docs_url = EXCLUDED.docs_url,
         metadata = EXCLUDED.metadata,
         last_seen_at = EXCLUDED.last_seen_at,
         deprecated_at = EXCLUDED.deprecated_at
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        row.kind,
        row.name,
        row.description,
        row.usage,
        row.docsUrl,
        JSON.stringify(row.metadata ?? {}),
        SEED_FIRST_SEEN_AT,
        now,
        deprecatedAt,
      ],
    );
    if (result.rows[0]?.inserted) inserted++;
    else updated++;
  }

  await pool.end();
  console.log(
    `cli_reference seed complete — ${inserted} inserted, ${updated} updated (${ROWS.length} fixture rows).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
