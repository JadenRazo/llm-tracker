import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight, Clock } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import {
  cliReference,
  events,
  mcpServers,
  type CliReference,
  type Event,
  type McpServer,
} from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import { listGuides } from "@/lib/content";
import { getCurrentCliVersion } from "@/lib/current-cli";
import { stableCliVersion } from "@/lib/stable-cli";
import { CommandGrid } from "@/components/home/command-grid";
import { McpGrid } from "@/components/home/mcp-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { DataUnavailable } from "@/components/ui/data-unavailable";
import { EventCard } from "@/components/event-card";
import { SectionHeading } from "@/components/ui/section-heading";
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
  const provider = parseProviderParam((await params).provider);
  return provider
    ? {
        title: getProviderMeta(provider).toolName,
        description: `Explore ${getProviderMeta(provider).toolName} commands, models, guides, and recent updates.`,
      }
    : { title: "Not found" };
}
// The database is read per request; the CDN owns bounded caching.
export const dynamic = "force-dynamic";

interface ProviderFeed {
  mcp: McpServer[];
  cliRef: CliReference[];
  recent: Event[];
}
async function loadFeed(provider: Provider): Promise<ProviderFeed | null> {
  const db = tryGetDb();
  if (!db) return null;
  try {
    const [mcp, cliRef, recent] = await Promise.all([
      provider === DEFAULT_PROVIDER
        ? db.select().from(mcpServers).orderBy(desc(mcpServers.rank)).limit(9)
        : Promise.resolve([] as McpServer[]),
      db
        .select()
        .from(cliReference)
        .where(
          sql`${cliReference.provider} = ${provider} and ${cliReference.deprecatedAt} is null`,
        )
        .orderBy(desc(cliReference.firstSeenAt))
        .limit(120),
      db
        .select()
        .from(events)
        .where(eq(events.provider, provider))
        .orderBy(eventRecencyDesc)
        .limit(6),
    ]);
    return { mcp, cliRef, recent };
  } catch {
    return null;
  }
}

export default async function ProviderHomePage({ params }: PageProps) {
  const provider = parseProviderParam((await params).provider);
  if (!provider) notFound();
  const meta = getProviderMeta(provider);
  const [feed, observedCli] = await Promise.all([
    loadFeed(provider),
    getCurrentCliVersion(provider),
  ]);
  const latestCli = stableCliVersion(observedCli);
  const guides = listGuides()
    .filter((g) => g.frontmatter.provider === provider)
    .slice(0, 3);
  return (
    <div
      className="provider-page"
      style={{ ["--provider-accent" as string]: meta.accentVar }}
    >
      <header className="provider-intro">
        <div>
          <p className="intro-kicker">{meta.label} / Learn</p>
          <h1>{meta.toolName}, at your fingertips.</h1>
          <p>
            Find a command, explore the models, or catch up on what changed.
          </p>
        </div>
        <Link href={`/${provider}/releases`} className="stable-release-link">
          <span>Latest tracked stable</span>
          <strong>{latestCli ? `v${latestCli}` : "Browse releases"}</strong>
          <span>
            Release notes <ArrowUpRight size={14} aria-hidden />
          </span>
        </Link>
      </header>
      <nav className="provider-jump-links" aria-label="On this page">
        <a href="#reference">Commands</a>
        <Link href={`/${provider}/models`}>
          Models
          <ArrowUpRight size={13} aria-hidden />
        </Link>
        <a href="#recent">Recent updates</a>
        {guides.length ? <a href="#guides">Guides</a> : null}
        {feed?.mcp.length ? <a href="#mcp">MCP servers</a> : null}
      </nav>
      {feed === null ? (
        <DataUnavailable what={`${meta.label} reference data`} />
      ) : null}
      <div className="space-y-[var(--space-section)]">
        <section id="reference" className="scroll-mt-40">
          <SectionHeading
            title="Command reference"
            action={
              <span className="text-ui-sm text-[var(--color-text-muted)]">
                Select a command for usage & docs
              </span>
            }
          />
          {feed ? <CommandGrid key={provider} items={feed.cliRef} /> : null}
        </section>
        {guides.length > 0 ? (
          <section id="guides" className="scroll-mt-40">
            <SectionHeading
              title="Make more of your tools"
              action={
                <Link
                  href={`/${provider}/guides`}
                  className="quiet-link inline-flex gap-2"
                >
                  All guides
                  <ArrowRight size={15} aria-hidden />
                </Link>
              }
            />
            <div className="guide-shelf">
              {guides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/${provider}/guides/${guide.slug}`}
                >
                  <p>{guide.readingTime}</p>
                  <h3>
                    {guide.frontmatter.title}
                    <ArrowUpRight size={17} aria-hidden />
                  </h3>
                  {guide.frontmatter.summary ? (
                    <p>{guide.frontmatter.summary}</p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <section id="recent" className="scroll-mt-40">
          <SectionHeading
            title={`Recent ${meta.label} updates`}
            action={
              <Link
                href={`/${provider}/changelog`}
                className="quiet-link inline-flex gap-2"
              >
                Full changelog
                <ArrowRight size={15} aria-hidden />
              </Link>
            }
          />
          {feed ? (
            feed.recent.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {feed.recent.map((event) => (
                  <EventCard key={event.id} event={event} size="sm" />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Clock}
                title="No updates recorded yet"
                description={`Recent ${meta.label} activity will appear here when available.`}
              />
            )
          ) : null}
        </section>
        {feed && feed.mcp.length > 0 ? (
          <section id="mcp" className="scroll-mt-40">
            <SectionHeading title="Explore MCP servers" />
            <McpGrid servers={feed.mcp} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
