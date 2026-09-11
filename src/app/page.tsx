import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Clock, Rss } from "lucide-react";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, type Event } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import { getCurrentCliVersion } from "@/lib/current-cli";
import { stableCliVersion } from "@/lib/stable-cli";
import { buildActivity } from "@/lib/activity";
import { ActivityFeed } from "@/components/home/activity-feed";
import { EmptyState } from "@/components/ui/empty-state";
import { DataUnavailable } from "@/components/ui/data-unavailable";
import type { LoadResult } from "@/lib/load-result";
import { PROVIDERS } from "@/lib/providers";
import { getProviderMeta } from "@/lib/provider-meta";

export const metadata: Metadata = {
  title: {
    absolute: "LLM Tracker — what's shipping across Claude, OpenAI & Gemini",
  },
  description:
    "Follow releases, model catalogs, developer tools, and provider status across Claude, OpenAI, and Gemini. Search recent updates and explore each provider.",
};

// Live DB reads; bounded caching remains owned by next.config.ts.
export const dynamic = "force-dynamic";

async function loadCrossProviderFeed(): Promise<LoadResult<Event>> {
  const db = tryGetDb();
  if (!db) return null;
  try {
    const slices = await Promise.all(
      PROVIDERS.map(async (provider) => {
        // Sample ordinary updates separately so bursts of nightly/alpha builds
        // cannot evict every stable release before the UI filters are applied.
        const prerelease = and(
          inArray(events.source, [...getProviderMeta(provider).releaseSources]),
          or(
            eq(events.type, "prerelease"),
            sql`${events.title} ~ '[0-9]+[.][0-9]+[.][0-9]+-'`,
          ),
        )!;
        const [regular, preview, status] = await Promise.all([
          db
            .select()
            .from(events)
            .where(
              and(
                eq(events.provider, provider),
                ne(events.source, getProviderMeta(provider).statusSource),
                sql`not coalesce(${prerelease}, false)`,
              ),
            )
            .orderBy(eventRecencyDesc)
            .limit(18),
          db
            .select()
            .from(events)
            .where(and(eq(events.provider, provider), prerelease))
            .orderBy(eventRecencyDesc)
            .limit(6),
          db
            .select()
            .from(events)
            .where(
              and(
                eq(events.provider, provider),
                eq(events.source, getProviderMeta(provider).statusSource),
              ),
            )
            .orderBy(eventRecencyDesc)
            .limit(3),
        ]);
        return [...regular, ...preview, ...status];
      }),
    );
    return slices.flat();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [feed, versions] = await Promise.all([
    loadCrossProviderFeed(),
    Promise.all(
      PROVIDERS.map(async (provider) =>
        stableCliVersion(await getCurrentCliVersion(provider)),
      ),
    ),
  ]);
  return (
    <div className="overview-page">
      <section className="overview-intro">
        <div>
          <p className="intro-kicker">Claude · OpenAI · Gemini</p>
          <h1>
            A clearer view of <span>what’s shipping.</span>
          </h1>
          <p className="intro-description">
            Releases, models, and developer tools. The changes worth catching,
            in one place.
          </p>
        </div>
        <a href="/rss.xml" className="intro-subscribe">
          <Rss size={16} aria-hidden />
          Follow the feed
          <ArrowUpRight size={16} aria-hidden />
        </a>
      </section>
      <div className="overview-grid">
        <section className="min-w-0" aria-labelledby="activity-heading">
          <div className="dashboard-section-heading">
            <h2 id="activity-heading">Latest updates</h2>
            <span>From the sources</span>
          </div>
          {feed === null ? (
            <DataUnavailable what="The update feed" />
          ) : feed.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No updates recorded yet"
              description="Browse a provider’s resources below, or check back for recent activity."
            />
          ) : (
            <ActivityFeed items={buildActivity(feed)} />
          )}
        </section>
        <aside className="overview-sidebar" aria-label="Provider resources">
          <section className="provider-directory">
            <div className="dashboard-section-heading">
              <h2>Your toolkit</h2>
              <span>Latest tracked stable</span>
            </div>
            {PROVIDERS.map((provider, i) => {
              const meta = getProviderMeta(provider);
              return (
                <div
                  key={provider}
                  className="provider-resource"
                  style={{ ["--provider-accent" as string]: meta.accentVar }}
                >
                  <div className="provider-resource-title">
                    <Link href={`/${provider}`}>
                      <span className="provider-dot" aria-hidden />
                      {meta.toolName}
                      <ArrowUpRight size={16} aria-hidden />
                    </Link>
                    <span>{meta.label}</span>
                  </div>
                  <Link
                    className="provider-version"
                    href={`/${provider}/releases`}
                  >
                    {versions[i] ? (
                      <>
                        v{versions[i]}
                        <span>
                          Release notes <ArrowRight size={14} aria-hidden />
                        </span>
                      </>
                    ) : (
                      <>
                        Browse releases
                        <ArrowRight size={14} aria-hidden />
                      </>
                    )}
                  </Link>
                  <nav aria-label={`${meta.label} resources`}>
                    <Link href={`/${provider}/models`}>Models</Link>
                    <Link href={`/${provider}#reference`}>Commands</Link>
                    <Link href={`/${provider}/status`}>Status</Link>
                  </nav>
                </div>
              );
            })}
            <p className="text-ui-md text-[var(--color-text-muted)]">
              Versions are the latest stable releases observed on npm. Follow
              the source links for full details.
            </p>
          </section>
          <section className="reading-note">
            <BookOpen size={21} aria-hidden />
            <h2>Put the tools to work.</h2>
            <p>
              Practical setup guides, workflows, and a searchable command
              reference.
            </p>
            <Link href="/claude/guides">
              Explore Claude guides
              <ArrowRight size={16} aria-hidden />
            </Link>
          </section>
          <section className="source-note">
            <h2>Trace it to the source.</h2>
            <p>
              Follow links to provider docs, release notes, and status pages.
              “Detected” means the source did not supply a publication date.
            </p>
            {/* Health is a JSON route handler, not a client page. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/health">
              Tracker health
              <ArrowUpRight size={14} aria-hidden />
            </a>
          </section>
        </aside>
      </div>
    </div>
  );
}
