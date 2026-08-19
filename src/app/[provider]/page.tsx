// Per-provider learn-surface. Mirrors the legacy `/` home but scoped to one
// provider: that provider's CLI reference, releases, guides, and a freshness
// proof built from its own pollers. For `claude` this is content-equivalent
// to the pre-2.3 home (MCP grid + start-here bento + news-driven proof);
// other providers get the same skeleton minus the Claude-only MCP section.

import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Boxes, Clock, Package, Terminal } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { cliReference, events, mcpServers, models } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import type { CliReference, Event, McpServer } from "@/lib/db/schema";
import { listGuides } from "@/lib/content";
import { CommandGrid } from "@/components/home/command-grid";
import { McpGrid } from "@/components/home/mcp-grid";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/event-card";
import { RelativeTime } from "@/components/ui/relative-time";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  extractLatestModel,
  pickRecentNews,
  type ModelAnnouncement,
  type NewsItem,
} from "@/lib/whats-new";
import { DEFAULT_PROVIDER, PROVIDERS, type Provider } from "@/lib/providers";
import { parseProviderParam } from "@/lib/provider-route";
import { getProviderMeta } from "@/lib/provider-meta";

interface PageProps {
  params: Promise<{ provider: string }>;
}

export function generateStaticParams() {
  return PROVIDERS.map((provider) => ({ provider }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { provider } = await params;
  const p = parseProviderParam(provider);
  if (!p) return { title: "Not found" };
  const meta = getProviderMeta(p);
  return {
    // Resolves via the root template to e.g. "Claude Code — LLM Tracker".
    title: meta.toolName,
    description: meta.tagline,
  };
}

// ISR — every section reads live DB rows, but they change at most a few
// times a day, so a 5-minute revalidate window lets the CDN serve cached
// HTML. Builds without DATABASE_URL prerender an empty fallback via
// tryGetDb(); the first runtime revalidation fills it in. Unknown providers
// are hard-404'd upstream by src/middleware.ts (a top-level dynamic-segment
// `dynamicParams = false` only soft-404s in this Next version, so the gate
// lives in middleware, not here).
// Rendered per request (no ISR). This app runs as a Lambda container image with a
// READ-ONLY filesystem, so Next's incremental cache cannot persist a regeneration:
// any container with a cold cache served the build-time prerender, which CI produces
// with no DATABASE_URL and is therefore EMPTY. Whether a visitor saw data was a coin
// flip on container age, and CloudFront then pinned whichever answer it drew. The
// origin now always renders live DB data; the CDN owns caching via the explicit,
// bounded Cache-Control set for this path in next.config.ts.
export const dynamic = "force-dynamic";

interface ProviderFeed {
  mcp: McpServer[];
  cliRef: CliReference[];
  latestCli: string | null;
  modelCount: number;
  latestModel: ModelAnnouncement | null;
  news: NewsItem[];
  recent: Event[];
}

const EMPTY: ProviderFeed = {
  mcp: [],
  cliRef: [],
  latestCli: null,
  modelCount: 0,
  latestModel: null,
  news: [],
  recent: [],
};

async function loadFeed(provider: Provider): Promise<ProviderFeed> {
  const db = tryGetDb();
  if (!db) return EMPTY;
  const pm = getProviderMeta(provider);
  try {
    const [mcpRows, cliRows, latestNpm, modelCountRow, newsRows, recentRows] =
      await Promise.all([
        // MCP catalog is Claude-only (no provider column); skip for others.
        provider === DEFAULT_PROVIDER
          ? db
              .select()
              .from(mcpServers)
              .orderBy(desc(mcpServers.rank))
              .limit(9)
          : Promise.resolve([] as McpServer[]),
        db
          .select()
          .from(cliReference)
          .where(
            sql`${cliReference.provider} = ${provider} and ${cliReference.deprecatedAt} is null`,
          )
          .orderBy(desc(cliReference.firstSeenAt))
          .limit(48),
        db.query.events.findFirst({
          where: (e, { eq: eqQ }) => eqQ(e.source, pm.cliVersionSource),
          orderBy: () => [eventRecencyDesc],
        }),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(models)
          .where(eq(models.provider, provider)),
        db
          .select()
          .from(events)
          .where(eq(events.source, pm.newsSource))
          .orderBy(desc(events.detectedAt))
          .limit(12),
        db
          .select()
          .from(events)
          .where(eq(events.provider, provider))
          .orderBy(eventRecencyDesc)
          .limit(8),
      ]);

    const latestModel = extractLatestModel(newsRows);
    const news = pickRecentNews(newsRows, 3, {
      excludeModelName: latestModel?.name,
    });

    return {
      mcp: mcpRows,
      cliRef: cliRows,
      latestCli: latestNpm?.title.replace(/^v/, "") ?? null,
      modelCount: modelCountRow[0]?.count ?? 0,
      latestModel,
      news,
      recent: recentRows,
    };
  } catch {
    return EMPTY;
  }
}

function LearnHero({
  provider,
  latestCli,
}: {
  provider: Provider;
  latestCli: string | null;
}) {
  const meta = getProviderMeta(provider);
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-6 animate-in sm:p-8 lg:p-10"
      style={{ ["--provider-accent" as string]: meta.accentVar }}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3 text-meta text-[var(--color-text-muted)]">
          <span>{meta.label.toUpperCase()} · LLM TRACKER</span>
          {latestCli ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="size-1.5 rounded-full bg-[var(--provider-accent)] animate-pulse-dot"
                  aria-hidden
                />
                {meta.toolName} v{latestCli} detected
              </span>
            </>
          ) : null}
        </div>
        <h1 className="max-w-3xl text-display-lg text-[var(--color-text-primary)] sm:text-display-xl">
          How to use {meta.toolName} in 2026,
          <br />
          kept current automatically.
        </h1>
        <p className="max-w-2xl text-ui-lg text-[var(--color-text-secondary)]">
          {meta.tagline} Every guide is version-pinned and re-verified as new
          releases ship — so stale advice flags itself instead of quietly
          misleading you.
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

function StartCard({
  eyebrow,
  title,
  description,
  href,
  className,
}: StartCardProps) {
  return (
    <Link
      href={href}
      className={`group relative block h-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${className ?? ""}`}
    >
      <span className="text-meta text-[var(--color-text-muted)]">{eyebrow}</span>
      <h3 className="mt-2 font-display text-display-md text-[var(--color-text-primary)] group-hover:text-[var(--color-highlight)]">
        {title}
      </h3>
      <p className="mt-3 text-ui-md text-[var(--color-text-secondary)]">
        {description}
      </p>
      <ArrowUpRight
        className="absolute right-5 top-5 size-5 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-ring)]"
        aria-hidden
      />
    </Link>
  );
}

/** Claude-only start-here bento — preserves the legacy home content exactly. */
function ClaudeStartHere() {
  return (
    <section className="animate-in">
      <SectionHeading eyebrow="START HERE" title="Where to start" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StartCard
          className="lg:col-span-2 lg:row-span-1"
          eyebrow="NEW TO CLAUDE CODE"
          title="The best setup for 2026"
          description="Skip the feature tour. Shortest path from empty directory to a Claude Code setup that behaves well for real work — native installer, settings.json, skills, and the two MCP servers worth the context tax."
          href="/claude/guides/claude-code-best-setup"
        />
        <StartCard
          eyebrow="ALREADY A POWER USER"
          title="Tips worth 10 minutes"
          description="Ultrareview, forked subagents, skills vs. commands — the things that changed in the last quarter."
          href="/claude/tips"
        />
        <StartCard
          className="lg:col-span-2"
          eyebrow="BUILDING WITH THE API"
          title="Claude Code releases & SDKs"
          description="Version ladder from npm, CHANGELOG, and the GitHub releases of every language SDK — deduped into one timeline."
          href="/claude/releases"
        />
        <StartCard
          eyebrow="CONTEXT ENGINEERING"
          title="Long sessions, sharper"
          description="Layered CLAUDE.md, auto-memory, compaction. The discipline that makes 1M tokens feel like 100K."
          href="/claude/guides/context-engineering"
        />
      </div>
    </section>
  );
}

function FreshnessProof({
  provider,
  latestModel,
  news,
  modelCount,
  latestCli,
}: {
  provider: Provider;
  latestModel: ModelAnnouncement | null;
  news: NewsItem[];
  modelCount: number;
  latestCli: string | null;
}) {
  const meta = getProviderMeta(provider);
  const hasAnything = latestModel !== null || news.length > 0;
  return (
    <section className="animate-in">
      <SectionHeading
        eyebrow="TRACKER FRESHNESS PROOF"
        title="The pollers behind this page"
        action={
          <Link
            href={`/${provider}/changelog`}
            className="text-ui-sm text-[var(--color-text-muted)] hover:text-[var(--color-highlight)]"
          >
            Full activity →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card variant="outlined">
          <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
            <Package className="size-3.5" aria-hidden /> {meta.toolName}
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
            <Boxes className="size-3.5" aria-hidden /> Models in catalog
          </div>
          <div className="mt-2 font-mono text-display-sm text-[var(--color-text-primary)]">
            {modelCount > 0 ? modelCount : "—"}
          </div>
          <div className="mt-1 text-meta text-[var(--color-text-muted)]">
            {latestModel
              ? `newest: ${latestModel.name}`
              : `from ${meta.label}`}
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
            <Clock className="size-3.5" aria-hidden /> Recent {meta.label} news
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

export default async function ProviderHomePage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const { mcp, cliRef, latestCli, modelCount, latestModel, news, recent } =
    await loadFeed(provider);
  const guides = listGuides()
    .filter((g) => g.frontmatter.provider === provider)
    .slice(0, 3);

  return (
    <Container>
      <div className="space-y-[var(--space-section)]">
        <LearnHero provider={provider} latestCli={latestCli} />

        {provider === DEFAULT_PROVIDER ? (
          <>
            <ClaudeStartHere />

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
          </>
        ) : null}

        <section className="animate-in">
          <SectionHeading
            eyebrow="ESSENTIAL COMMANDS & FLAGS"
            title={`${meta.toolName} reference`}
            action={
              <span className="inline-flex items-center gap-2 text-ui-sm text-[var(--color-text-muted)]">
                <Terminal className="size-3.5" aria-hidden />
                {cliRef.length} tokens
              </span>
            }
          />
          <CommandGrid items={cliRef} />
        </section>

        {provider !== DEFAULT_PROVIDER ? (
          <section className="animate-in">
            <SectionHeading
              eyebrow="LATEST ACTIVITY"
              title={`What's new in ${meta.label}`}
              action={
                <Link
                  href={`/${provider}/changelog`}
                  className="text-ui-sm text-[var(--color-text-muted)] hover:text-[var(--color-highlight)]"
                >
                  Full changelog →
                </Link>
              }
            />
            {recent.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Pollers warming up"
                description={`The ${meta.label} sources run every 10–30 minutes. First data arrives within a minute of deploy.`}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recent.slice(0, 6).map((e) => (
                  <EventCard key={e.id} event={e} size="sm" />
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="animate-in">
          <SectionHeading
            eyebrow="LATEST GUIDES"
            title="Version-pinned, staleness-aware"
            action={
              <Link
                href={`/${provider}/guides`}
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
              description={`No ${meta.label} guides published yet — they'll appear here as content is added.`}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {guides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/${provider}/guides/${g.slug}`}
                  className="group block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
                >
                  <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
                    {g.frontmatter.category ? (
                      <span>{g.frontmatter.category}</span>
                    ) : null}
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
          provider={provider}
          latestModel={latestModel}
          news={news}
          modelCount={modelCount}
          latestCli={latestCli}
        />
      </div>
    </Container>
  );
}
