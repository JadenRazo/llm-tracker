// Drizzle schema for LLM Tracker.
//
// Column naming convention:
//   - TypeScript keys: camelCase  (e.g. externalId)
//   - PostgreSQL columns: snake_case (first string arg to each builder)
//
// Tables:
//   - events:        every discovered release/incident/changelog entry, deduped.
//   - models:        current Anthropic model catalog (one row per model id).
//   - cli_reference: Claude Code slash commands, flags, hook events, skills.
//   - mcp_servers:   curated MCP-servers catalog with ranking + overrides.
//   - poller_runs:   bookkeeping for each source run (etag, last_modified, errors).

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const nowTz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).defaultNow().notNull();

// ---------------------------------------------------------------------------
// events — unified timeline across every source
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    /** Source module key, e.g. "npm_claude_code", "anthropic_status". */
    source: text("source").notNull(),
    /** Optional sub-category inside a source (e.g. "release", "incident"). */
    type: text("type"),
    /** Source-specific unique id (version, incident id, "{repo}:{tag}", slug, etc.). */
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    /** Rendered markdown body — may be null (e.g. anthropic_news where only link is scraped). */
    bodyMd: text("body_md"),
    url: text("url"),
    /** When the poller first detected this row. */
    detectedAt: nowTz("detected_at"),
    /** When the event actually occurred upstream (release date, incident createdAt, etc.). */
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    /** sha256 of bodyMd (or a canonical subset) — used for dedupe on re-scrape. */
    contentHash: text("content_hash"),
    /** Owning LLM provider ("claude" | "openai" | "gemini"). NOT NULL since
     *  Phase 2.5 (fully backfilled in 2.0); defaults to "claude". */
    provider: text("provider").notNull().default("claude"),
  },
  (t) => ({
    sourceExternalUnique: uniqueIndex("events_source_external_idx").on(t.source, t.externalId),
    detectedIdx: index("events_detected_idx").on(t.detectedAt),
    publishedIdx: index("events_published_idx").on(t.publishedAt),
    sourceIdx: index("events_source_idx").on(t.source),
    providerIdx: index("events_provider_idx").on(t.provider),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

// ---------------------------------------------------------------------------
// models — current Anthropic catalog
// ---------------------------------------------------------------------------

export const models = pgTable(
  "models",
  {
    /** Model ID as returned by /v1/models, e.g. "claude-opus-4-7". */
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    contextWindow: integer("context_window"),
    maxOutput: integer("max_output"),
    /** USD per million input tokens. */
    pricingIn: numeric("pricing_in", { precision: 10, scale: 4 }),
    /** USD per million output tokens. */
    pricingOut: numeric("pricing_out", { precision: 10, scale: 4 }),
    /** { toolUse: boolean, vision: boolean, extendedThinking: boolean, ... } */
    capabilities: jsonb("capabilities").$type<Record<string, boolean>>().default(sql`'{}'::jsonb`),
    firstSeenAt: nowTz("first_seen_at"),
    lastSeenAt: nowTz("last_seen_at"),
    /** Owning LLM provider ("claude" | "openai" | "gemini"). NOT NULL since
     *  Phase 2.5 (fully backfilled in 2.0); defaults to "claude". */
    provider: text("provider").notNull().default("claude"),
  },
  (t) => ({
    providerIdx: index("models_provider_idx").on(t.provider),
  }),
);

export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;

// ---------------------------------------------------------------------------
// cli_reference — Claude Code slash commands, flags, subcommands, hook events
// ---------------------------------------------------------------------------

export const cliReference = pgTable(
  "cli_reference",
  {
    /** Composite id: "{kind}:{name}" e.g. "slash:/init", "flag:--print". */
    id: text("id").primaryKey(),
    /** "slash" | "flag" | "cli-subcommand" | "hook-event" | "skill". */
    kind: text("kind").notNull(),
    /** Canonical token: "/init", "--print", "claude update", "PreToolUse". */
    name: text("name").notNull(),
    description: text("description"),
    /** Canonical usage snippet, e.g. `claude --print "query"`. */
    usage: text("usage"),
    /** Deep link to the docs anchor. */
    docsUrl: text("docs_url"),
    /** Kind-specific metadata: { aliases, takesValue, canBlock, ... }. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    /** Set on first insert, never updated — drives "new since X" filtering. */
    firstSeenAt: nowTz("first_seen_at"),
    /** Updated every successful poll — a row missing for 3+ days is presumed deprecated. */
    lastSeenAt: nowTz("last_seen_at"),
    /** Set when we flip a row to deprecated (still rendered, but struck-through). Nullable. */
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true, mode: "date" }),
    /** Owning LLM provider ("claude" | "openai" | "gemini"). NOT NULL since
     *  Phase 2.5 (fully backfilled in 2.0); defaults to "claude". */
    provider: text("provider").notNull().default("claude"),
  },
  (t) => ({
    kindIdx: index("cli_reference_kind_idx").on(t.kind),
    firstSeenIdx: index("cli_reference_first_seen_idx").on(t.firstSeenAt),
    providerIdx: index("cli_reference_provider_idx").on(t.provider),
  }),
);

export type CliReference = typeof cliReference.$inferSelect;
export type NewCliReference = typeof cliReference.$inferInsert;

// ---------------------------------------------------------------------------
// mcp_servers — curated MCP-servers catalog, auto-refreshed + manual overrides
// ---------------------------------------------------------------------------

export const mcpServers = pgTable(
  "mcp_servers",
  {
    /** "{owner}/{repo}" canonical GitHub slug. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    repoUrl: text("repo_url").notNull(),
    stars: integer("stars"),
    lastCommitAt: timestamp("last_commit_at", { withTimezone: true, mode: "date" }),
    official: boolean("official").notNull().default(false),
    category: text("category"),
    installCmd: text("install_cmd"),
    /** Computed ordering score — ORDER BY rank DESC for landing-page list. */
    rank: integer("rank").notNull().default(0),
    firstSeenAt: nowTz("first_seen_at"),
    lastSeenAt: nowTz("last_seen_at"),
  },
  (t) => ({
    rankIdx: index("mcp_servers_rank_idx").on(t.rank),
    officialIdx: index("mcp_servers_official_idx").on(t.official),
  }),
);

export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;

// ---------------------------------------------------------------------------
// poller_runs — one row per attempt, per source
// ---------------------------------------------------------------------------

export const pollerRuns = pgTable(
  "poller_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    /** "ok" | "unchanged" | "error" | "skipped" */
    status: text("status").notNull(),
    startedAt: nowTz("started_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    /** Most recent ETag returned — sent back as If-None-Match next time. */
    etag: text("etag"),
    /** Most recent Last-Modified returned — sent back as If-Modified-Since. */
    lastModified: text("last_modified"),
    /** For HTML scrapes that lack caching headers — hash of the body we parsed. */
    lastSeenHash: text("last_seen_hash"),
    error: text("error"),
  },
  (t) => ({
    sourceStartedIdx: index("poller_runs_source_started_idx").on(t.source, t.startedAt),
  }),
);

export type PollerRun = typeof pollerRuns.$inferSelect;
export type NewPollerRun = typeof pollerRuns.$inferInsert;
