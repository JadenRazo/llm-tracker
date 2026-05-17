// Cross-provider root. The legacy Claude-only home moved to `/claude`; this
// page is the multi-LLM entry surface: a typographic hero, the persistent
// provider switcher as the primary CTA, and one unified "what's new" feed
// aggregated across Claude / OpenAI / Gemini (provider-tagged, newest first).
//
// Working brand copy only — Phase 2.4 finalizes the name and metadata. Stays
// inside the earth/forest token system: one accent per provider mapped to an
// existing palette var, no gradients, no generic 3-up feature row.

import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import type { Event } from "@/lib/db/schema";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/event-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { isProvider, type Provider } from "@/lib/providers";
import { PROVIDER_ORDER, getProviderMeta } from "@/lib/provider-meta";

export const metadata: Metadata = {
  title: "How to use Claude, OpenAI & Gemini — tracker",
  description:
    "A self-updating reference across Claude, OpenAI, and Gemini — releases, CLIs, models, and docs, version-pinned and re-verified as they ship.",
};

// Force dynamic — the aggregated feed reads live DB rows; the Docker build
// runs without DATABASE_URL and would otherwise ship an empty page.
export const dynamic = "force-dynamic";

async function loadCrossProviderFeed(): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    // One pass across every provider's events, newest first. Rows carry a
    // `provider` column (backfilled in Phase 2.0) so the feed can tag each.
    return await db
      .select()
      .from(events)
      .orderBy(desc(events.publishedAt))
      .limit(24);
  } catch {
    return [];
  }
}

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-6 animate-in sm:p-8 lg:p-10">
      <div className="flex flex-col gap-6">
        <span className="text-meta text-[var(--color-text-muted)]">
          THE LLM TRACKER
        </span>
        <h1 className="max-w-3xl text-display-lg text-[var(--color-text-primary)] sm:text-display-xl">
          How to use the coding LLMs in 2026,
          <br />
          kept current automatically.
        </h1>
        <p className="max-w-2xl text-ui-lg text-[var(--color-text-secondary)]">
          One self-updating reference across Claude, OpenAI, and Gemini. Every
          release, CLI change, and model is version-pinned and re-verified as
          it ships — so stale advice flags itself instead of quietly misleading
          you. Pick a provider to dive in.
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
          {feed.length === 0 ? (
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
                    key={`${e.provider ?? "?"}-${e.id}`}
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
