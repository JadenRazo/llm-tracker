// Home — the learn-surface for Claude Code, MCP, and the Anthropic API.
//
// Replaces the old "what's new" feed. Section order:
//   1. Hero  — honest pitch + live CLI version pill.
//   2. Start-here bento — three entry points (New / Power user / API builder).
//   3. Top MCP servers — ranked live from `mcp_servers`.
//   4. Essential commands & flags — live from `cli_reference`, grouped by kind.
//   5. Latest guides — three most-recent from content/guides/.
//   6. Tracker freshness proof — demoted "what's new" strip; proves the
//      self-updating story is real.

import { desc, eq, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock, Package, Sparkles, Terminal } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { cliReference, events, mcpServers, models } from "@/lib/db/schema";
import type { CliReference, McpServer } from "@/lib/db/schema";
import { listGuides } from "@/lib/content";
import { CommandGrid } from "@/components/home/command-grid";
import { McpGrid } from "@/components/home/mcp-grid";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  extractLatestModel,
  pickRecentNews,
  type ModelAnnouncement,
  type NewsItem,
} from "@/lib/whats-new";

export const metadata: Metadata = {
  title: "How to use Claude — tracker",
  description:
    "A self-updating reference for Claude Code, MCP, and the Anthropic API. Every guide is version-pinned and re-verified as new releases ship.",
};
// ISR — the home feed changes at most a few times a day (pollers run every
// 5–30 min), so a 5-minute revalidate window lets the CDN serve cached HTML
// (s-maxage) instead of no-store. Builds without DATABASE_URL prerender an
// empty fallback via tryGetDb(); the first runtime revalidation fills it in.
export const revalidate = 300;

interface LearnFeed {
  mcp: McpServer[];
  cliRef: CliReference[];
  latestCli: string | null;
  modelCount: number;
  latestModel: ModelAnnouncement | null;
  news: NewsItem[];
}

const EMPTY: LearnFeed = {
  mcp: [],
  cliRef: [],
  latestCli: null,
  modelCount: 0,
  latestModel: null,
  news: [],
};

async function loadFeed(): Promise<LearnFeed> {
  const db = tryGetDb();
  if (!db) return EMPTY;
  try {
    const [mcpRows, cliRows, latestNpm, modelCountRow, newsRows] =
      await Promise.all([
        db.select().from(mcpServers).orderBy(desc(mcpServers.rank)).limit(9),
        db
          .select()
          .from(cliReference)
          .where(isNull(cliReference.deprecatedAt))
          .orderBy(desc(cliReference.firstSeenAt))
          .limit(48),
        db.query.events.findFirst({
          where: (e, { eq: eqQ }) => eqQ(e.source, "npm_claude_code"),
          orderBy: (e, { desc: d }) => [d(e.publishedAt)],
        }),
        db.select({ count: sql<number>`count(*)::int` }).from(models),
        db
          .select()
          .from(events)
          .where(eq(events.source, "anthropic_news"))
          .orderBy(desc(events.detectedAt))
          .limit(12),
      ]);

    const latestModel = extractLatestModel(newsRows);
    const news = pickRecentNews(newsRows, 3, { excludeModelName: latestModel?.name });

    return {
      mcp: mcpRows,
      cliRef: cliRows,
      latestCli: latestNpm?.title.replace(/^v/, "") ?? null,
      modelCount: modelCountRow[0]?.count ?? 0,
      latestModel,
      news,
    };
  } catch {
    return EMPTY;
  }
}

function LearnHero({ latestCli }: { latestCli: string | null }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-6 animate-in sm:p-8 lg:p-10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3 text-meta text-[var(--color-text-muted)]">
          <span>THE CLAUDE TRACKER</span>
          {latestCli ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="size-1.5 rounded-full bg-[var(--color-leaf)] animate-pulse-dot"
                  aria-hidden
                />
                Claude Code v{latestCli} detected
              </span>
            </>
          ) : null}
        </div>
        <h1 className="max-w-3xl text-display-lg text-[var(--color-text-primary)] sm:text-display-xl">
          How to use Claude in 2026,
          <br />
          kept current automatically.
        </h1>
        <p className="max-w-2xl text-ui-lg text-[var(--color-text-secondary)]">
          A self-updating reference for Claude Code, MCP, and the Anthropic API.
          Every guide is version-pinned and re-verified as new releases ship —
          so stale advice flags itself instead of quietly misleading you.
        </p>
      </div>
    </section>
  );
}

interface StartCardProps {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  className?: string;
}

function StartCard({ eyebrow, title, description, href, className }: StartCardProps) {
  return (
    <Link
      href={href}
      className={`group relative block h-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${className ?? ""}`}
    >
      <span className="text-meta text-[var(--color-text-muted)]">{eyebrow}</span>
      <h3 className="mt-2 font-display text-display-md text-[var(--color-text-primary)] group-hover:text-[var(--color-highlight)]">
        {title}
      </h3>
      <p className="mt-3 text-ui-md text-[var(--color-text-secondary)]">{description}</p>
      <ArrowUpRight className="absolute right-5 top-5 size-5 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-ring)]" aria-hidden />
    </Link>
  );
}

function StartHere() {
  return (
    <section className="animate-in">
      <SectionHeading eyebrow="START HERE" title="Where to start" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Wide primary — spans 2 cols on lg, asymmetric with the two smaller cards. */}
        <StartCard
          className="lg:col-span-2 lg:row-span-1"
          eyebrow="NEW TO CLAUDE CODE"
          title="The best setup for 2026"
          description="Skip the feature tour. Shortest path from empty directory to a Claude Code setup that behaves well for real work — native installer, settings.json, skills, and the two MCP servers worth the context tax."
          href="/guides/claude-code-best-setup"
        />
        <StartCard
          eyebrow="ALREADY A POWER USER"
          title="Tips worth 10 minutes"
          description="Ultrareview, forked subagents, skills vs. commands — the things that changed in the last quarter."
          href="/tips"
        />
        <StartCard
          className="lg:col-span-2"
          eyebrow="BUILDING WITH THE API"
          title="Claude Code releases & SDKs"
          description="Version ladder from npm, CHANGELOG, and the GitHub releases of every language SDK — deduped into one timeline."
          href="/claude-code"
        />
        <StartCard
          eyebrow="CONTEXT ENGINEERING"
          title="Long sessions, sharper"
          description="Layered CLAUDE.md, auto-memory, compaction. The discipline that makes 1M tokens feel like 100K."
          href="/guides/context-engineering"
        />
      </div>
    </section>
  );
}

function FreshnessProof({
  latestModel,
  news,
  modelCount,
  latestCli,
}: {
  latestModel: ModelAnnouncement | null;
  news: NewsItem[];
  modelCount: number;
  latestCli: string | null;
}) {
  const hasAnything = latestModel !== null || news.length > 0;
  return (
    <section className="animate-in">
      <SectionHeading
        eyebrow="TRACKER FRESHNESS PROOF"
        title="The pollers behind this page"
        action={
          <Link
            href="/changelog"
            className="text-ui-sm text-[var(--color-text-muted)] hover:text-[var(--color-highlight)]"
          >
            Full activity →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card variant="outlined">
          <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
            <Package className="size-3.5" aria-hidden /> Claude Code
          </div>
          <div className="mt-2 font-mono text-display-sm text-[var(--color-text-primary)]">
            {latestCli ? `v${latestCli}` : "—"}
          </div>
          <div className="mt-1 text-meta text-[var(--color-text-muted)]">
            latest on npm
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
            <Sparkles className="size-3.5" aria-hidden /> Models in catalog
          </div>
          <div className="mt-2 font-mono text-display-sm text-[var(--color-text-primary)]">
            {modelCount > 0 ? modelCount : "—"}
          </div>
          <div className="mt-1 text-meta text-[var(--color-text-muted)]">
            {latestModel ? `newest: ${latestModel.name}` : "from platform.claude.com"}
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
            <Clock className="size-3.5" aria-hidden /> Recent Anthropic news
          </div>
          <div className="mt-2 font-mono text-display-sm text-[var(--color-text-primary)]">
            {news.length}
          </div>
          <div className="mt-1 text-meta text-[var(--color-text-muted)]">
            {news[0] ? (
              <RelativeTime date={news[0].publishedAt ?? new Date()} />
            ) : (
              "past 14 days"
            )}
          </div>
        </Card>
      </div>
      {!hasAnything ? (
        <div className="mt-4">
          <EmptyState
            icon={Clock}
            title="Pollers warming up"
            description="T1 (10m) + T2 (30m) + T3 (2h) tiers all kick at boot. First data arrives within a minute."
          />
        </div>
      ) : null}
    </section>
  );
}

export default async function HomePage() {
  const { mcp, cliRef, latestCli, modelCount, latestModel, news } = await loadFeed();
  const guides = listGuides().slice(0, 3);

  return (
    <Container>
      <div className="space-y-[var(--space-section)]">
        <LearnHero latestCli={latestCli} />

        <StartHere />

        <section className="animate-in">
          <SectionHeading
            eyebrow="TOP MCP SERVERS"
            title="The short list worth your context budget"
            action={
              <span className="text-ui-sm text-[var(--color-text-muted)]">
                auto-refreshed every 2h
              </span>
            }
          />
          <McpGrid servers={mcp} />
        </section>

        <section className="animate-in">
          <SectionHeading
            eyebrow="ESSENTIAL COMMANDS & FLAGS"
            title="Scraped from code.claude.com"
            action={
              <span className="inline-flex items-center gap-2 text-ui-sm text-[var(--color-text-muted)]">
                <Terminal className="size-3.5" aria-hidden />
                {cliRef.length} tokens
              </span>
            }
          />
          <CommandGrid items={cliRef} />
        </section>

        <section className="animate-in">
          <SectionHeading
            eyebrow="LATEST GUIDES"
            title="Version-pinned, staleness-aware"
            action={
              <Link
                href="/guides"
                className="text-ui-sm text-[var(--color-text-muted)] hover:text-[var(--color-highlight)]"
              >
                All guides →
              </Link>
            }
          />
          {guides.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No guides yet"
              description="Commit a markdown file under content/guides/ and redeploy."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className="group block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
                >
                  <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
                    {g.frontmatter.category ? <span>{g.frontmatter.category}</span> : null}
                    <span aria-hidden>·</span>
                    <span>{g.readingTime}</span>
                  </div>
                  <h3 className="mt-2 font-display text-display-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-highlight)]">
                    {g.frontmatter.title}
                  </h3>
                  {g.frontmatter.summary ? (
                    <p className="mt-2 text-ui-md text-[var(--color-text-secondary)]">
                      {g.frontmatter.summary}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </section>

        <FreshnessProof
          latestModel={latestModel}
          news={news}
          modelCount={modelCount}
          latestCli={latestCli}
        />
      </div>
    </Container>
  );
}
