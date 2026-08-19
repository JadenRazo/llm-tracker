// Cross-provider root. The legacy Claude-only home moved to `/claude`; this
// page is the multi-LLM entry surface: a typographic hero, the persistent
// provider switcher as the primary CTA, and one unified "what's new" feed
// aggregated across Claude / OpenAI / Gemini (provider-tagged, newest first).
//
// Brand: "LLM Tracker" at llm.raizhost.com. Stays inside the earth/forest
// token system: one accent per provider mapped to an existing palette var,
// no gradients, no generic 3-up feature row.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";
import { eq } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import type { Event } from "@/lib/db/schema";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { DataUnavailable } from "@/components/ui/data-unavailable";
import type { LoadResult } from "@/lib/load-result";
import { EventCard } from "@/components/event-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { isProvider, PROVIDERS, type Provider } from "@/lib/providers";
import { PROVIDER_ORDER, getProviderMeta } from "@/lib/provider-meta";

export const metadata: Metadata = {
  // Cross-provider home owns the site's default title verbatim — don't apply
  // the "%s — LLM Tracker" template to the root.
  title: {
    absolute: "LLM Tracker — what's shipping across Claude, OpenAI & Gemini",
  },
  description:
    "Track what ships across Claude, OpenAI, and Gemini in one place. Claude Code and Codex are the coding headliners; every release, CLI change, and model is version-pinned and re-verified as it lands.",
};

// ISR — the aggregated feed changes at most a few times a day (pollers run
// every 5–30 min), so a 5-minute revalidate window lets the CDN serve cached
// HTML (s-maxage) instead of no-store. Builds without DATABASE_URL prerender
// an empty fallback via tryGetDb(); the first runtime revalidation fills it in.
// Rendered per request (no ISR). This app runs as a Lambda container image with a
// READ-ONLY filesystem, so Next's incremental cache cannot persist a regeneration:
// any container with a cold cache served the build-time prerender, which CI produces
// with no DATABASE_URL and is therefore EMPTY. Whether a visitor saw data was a coin
// flip on container age, and CloudFront then pinned whichever answer it drew. The
// origin now always renders live DB data; the CDN owns caching via the explicit,
// bounded Cache-Control set for this path in next.config.ts.
export const dynamic = "force-dynamic";

/** Items shown per provider, so the strip always represents all three. */
const FEED_PER_PROVIDER = 8;

async function loadCrossProviderFeed(): Promise<LoadResult<Event>> {
  const db = tryGetDb();
  if (!db) return null;
  try {
    // Fetch the newest N PER PROVIDER, then merge by recency — not one flat
    // recency-ordered query. This section is headed "ACROSS EVERY PROVIDER", and
    // a flat query does not deliver that: Claude Code ships several releases a
    // week against Codex's and Gemini CLI's slower cadence, so pure recency
    // returned 23 of 24 Claude rows and the strip showed no OpenAI item at all
    // while the database held 2,795 of them. Per-provider slices keep the
    // ordering honest (still newest-first) while making the heading true.
    const perProvider = await Promise.all(
      PROVIDERS.map((provider) =>
        db
          .select()
          .from(events)
          .where(eq(events.provider, provider))
          .orderBy(eventRecencyDesc)
          .limit(FEED_PER_PROVIDER),
      ),
    );
    return perProvider
      .flat()
      .sort(
        (a, b) =>
          (b.publishedAt ?? b.detectedAt).getTime() -
          (a.publishedAt ?? a.detectedAt).getTime(),
      );
  } catch {
    return null;
  }
}

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-6 animate-in sm:p-8 lg:p-10">
      <div className="flex flex-col gap-6">
        <span className="text-meta text-[var(--color-text-muted)]">
          LLM TRACKER
        </span>
        <h1 className="max-w-3xl text-display-lg text-[var(--color-text-primary)] sm:text-display-xl">
          What&apos;s shipping across Claude,
          <br />
          OpenAI &amp; Gemini — tracked for you.
        </h1>
        <p className="max-w-2xl text-ui-lg text-[var(--color-text-secondary)]">
          One self-updating reference for all three. Claude Code and Codex are
          the coding headliners; the changelogs, CLI releases, and model
          catalogs are version-pinned and re-verified as each lands — so stale
          advice flags itself instead of quietly misleading you. Pick a
          provider to dive in.
        </p>
      </div>
    </section>
  );
}

/**
 * The persistent provider switcher, rendered here as the page's primary CTA.
 * Asymmetric: Claude (the established surface) takes the wide tile; OpenAI and
 * Gemini sit beside it. Each tile carries its own single accent from the
 * existing palette — no gradients, no icon-in-pastel-bubble.
 */
function ProviderPicker() {
  return (
    <section className="animate-in">
      <SectionHeading eyebrow="CHOOSE A PROVIDER" title="Where to start" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PROVIDER_ORDER.map((provider, i) => {
          const meta = getProviderMeta(provider);
          const wide = i === 0;
          return (
            <Link
              key={provider}
              href={`/${provider}`}
              style={{ ["--provider-accent" as string]: meta.accentVar }}
              className={[
                "group relative block h-full rounded-xl border bg-[var(--color-surface)] p-6",
                "border-[var(--color-border)] transition-transform duration-200",
                "hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                wide ? "lg:col-span-2" : "",
              ].join(" ")}
            >
              <span className="inline-flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
                <span
                  className="size-1.5 rounded-full bg-[var(--provider-accent)]"
                  aria-hidden
                />
                {meta.label.toUpperCase()}
              </span>
              <h3 className="mt-3 font-display text-display-md text-[var(--color-text-primary)] group-hover:text-[var(--color-highlight)]">
                {meta.toolName}
              </h3>
              <p className="mt-3 max-w-prose text-ui-md text-[var(--color-text-secondary)]">
                {meta.tagline}
              </p>
              <ArrowUpRight
                className="absolute right-5 top-5 size-5 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--provider-accent)]"
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ProviderTag({ provider }: { provider: Provider }) {
  const meta = getProviderMeta(provider);
  return (
    <Link
      href={`/${provider}`}
      style={{ ["--provider-accent" as string]: meta.accentVar }}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-meta text-[var(--color-text-secondary)] transition-colors hover:border-[var(--provider-accent)] hover:text-[var(--color-text-primary)]"
    >
      <span
        className="size-1.5 rounded-full bg-[var(--provider-accent)]"
        aria-hidden
      />
      {meta.label}
    </Link>
  );
}

export default async function HomePage() {
  const feed = await loadCrossProviderFeed();

  return (
    <Container>
      <div className="space-y-[var(--space-section)]">
        <Hero />

        <ProviderPicker />

        <section className="animate-in">
          <SectionHeading
            eyebrow="ACROSS EVERY PROVIDER"
            title="What's new"
            action={
              <span className="text-ui-sm text-[var(--color-text-muted)]">
                aggregated, newest first
              </span>
            }
          />
          {feed === null ? (
            <DataUnavailable what="The cross-provider feed" />
          ) : feed.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Pollers warming up"
              description="The cross-provider feed fills as each provider's sources ingest. First data arrives within a minute of deploy."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {feed.map((e) => {
                const provider = isProvider(e.provider) ? e.provider : null;
                return (
                  <li
                    key={`${e.provider}-${e.id}`}
                    className="space-y-1.5"
                  >
                    {provider ? (
                      <div className="flex">
                        <ProviderTag provider={provider} />
                      </div>
                    ) : null}
                    <EventCard event={e} size="sm" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Container>
  );
}
