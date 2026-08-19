// /[provider]/status — provider service status + incident history. Reads the
// provider's status source (anthropic_status / openai_status / gemini_status).
// Layout unchanged from the legacy /status: tinted hero card + dotted-rail
// incident timeline.

import { and, eq, ne } from "drizzle-orm";
import { MDXRemote } from "next-mdx-remote/rsc";
import { Activity, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import type { Event } from "@/lib/db/schema";
import { sanitizeMdx } from "@/lib/mdx-sanitize";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataUnavailable } from "@/components/ui/data-unavailable";
import type { LoadResult } from "@/lib/load-result";
import { RelativeTime } from "@/components/ui/relative-time";
import { EventCard } from "@/components/event-card";
import { PROVIDERS, type Provider } from "@/lib/providers";
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
  return { title: p ? `${getProviderMeta(p).label} status` : "Not found" };
}

// ISR — the status source is polled every 10 minutes, but a fresh incident
// should surface quickly, so use a 60-second revalidate window. Builds without
// DATABASE_URL prerender an empty fallback via tryGetDb(); the first runtime
// revalidation fills it in.
// Rendered per request (no ISR). This app runs as a Lambda container image with a
// READ-ONLY filesystem, so Next's incremental cache cannot persist a regeneration:
// any container with a cold cache served the build-time prerender, which CI produces
// with no DATABASE_URL and is therefore EMPTY. Whether a visitor saw data was a coin
// flip on container age, and CloudFront then pinned whichever answer it drew. The
// origin now always renders live DB data; the CDN owns caching via the explicit,
// bounded Cache-Control set for this path in next.config.ts.
export const dynamic = "force-dynamic";

type StatusTone = "operational" | "degraded" | "outage" | "neutral";

interface ToneMeta {
  color: string;
  label: string;
  pulse: boolean;
}

const TONE_META: Record<StatusTone, ToneMeta> = {
  operational: { color: "var(--color-leaf)", label: "Operational", pulse: false },
  degraded: { color: "var(--color-adobe)", label: "Degraded", pulse: true },
  outage: { color: "var(--color-terra)", label: "Major outage", pulse: true },
  neutral: { color: "var(--color-text-muted)", label: "Unknown", pulse: false },
};

function classifyStatus(title: string | null | undefined): StatusTone {
  if (!title) return "neutral";
  const s = title.toLowerCase();
  if (s.includes("major") || s.includes("outage") || s.includes("critical")) {
    return "outage";
  }
  if (s.includes("degraded") || s.includes("partial") || s.includes("minor")) {
    return "degraded";
  }
  if (s.includes("operational")) return "operational";
  return "neutral";
}

async function loadStatus(
  source: string,
): Promise<{ current: Event | null; incidents: Event[] } | null> {
  const db = tryGetDb();
  if (!db) return null;
  try {
    const [currentRows, incidentRows] = await Promise.all([
      db
        .select()
        .from(events)
        .where(and(eq(events.source, source), eq(events.externalId, "current")))
        .limit(1),
      db
        .select()
        .from(events)
        .where(and(eq(events.source, source), ne(events.externalId, "current")))
        .orderBy(eventRecencyDesc)
        .limit(50),
    ]);
    return { current: currentRows[0] ?? null, incidents: incidentRows };
  } catch {
    return null;
  }
}

export default async function StatusPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const status = await loadStatus(meta.statusSource);
  const current = status?.current ?? null;
  const incidents = status?.incidents ?? [];
  const tone = classifyStatus(current?.title);
  const toneMeta = TONE_META[tone];

  return (
    <Container>
      <PageHeader
        icon={Activity}
        eyebrow="UPTIME"
        title={`${meta.label} status`}
        description={`Live system status and recent incidents for ${meta.label}. Polled every 10 minutes.`}
      />

      <div className="space-y-[var(--space-section)]">
        <section className="animate-in">
          {current ? (
            <div style={{ ["--tone" as string]: toneMeta.color }}>
              <Card
                variant="raised"
                className="border-l-[6px] border-l-[var(--tone)] p-5 sm:p-6 md:p-8"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={
                      "inline-block size-2.5 rounded-full" +
                      (toneMeta.pulse ? " animate-pulse-dot" : "")
                    }
                    style={{ backgroundColor: "var(--tone)" }}
                    aria-hidden
                  />
                  <h2 className="text-display-md text-[var(--color-text-primary)]">
                    {current.title}
                  </h2>
                </div>
                <p className="mt-2 text-meta text-[var(--color-text-muted)]">
                  As of{" "}
                  <RelativeTime
                    date={current.publishedAt ?? current.detectedAt}
                    className="inline text-[var(--color-text-secondary)]"
                  />
                </p>
                {current.bodyMd ? (
                  <div className="prose mt-4 border-t border-[var(--color-border)]/40 pt-4">
                    <MDXRemote source={sanitizeMdx(current.bodyMd)} />
                  </div>
                ) : null}
              </Card>
            </div>
          ) : status === null ? (
            <DataUnavailable what="The status snapshot" />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Status stream warming up"
              description="No status snapshot has landed yet."
              hint={`The ${meta.label} status source is polled every 10 minutes.`}
            />
          )}
        </section>

        <section className="animate-in">
          <SectionHeading
            eyebrow="HISTORY"
            title="Recent incidents"
            count={incidents.length}
          />
          {status === null ? (
            <DataUnavailable what="Incident history" />
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="All clear"
              description="No incidents recorded yet."
              hint="Polled every 10 minutes — anything new will show up here first."
            />
          ) : (
            <ol className="relative space-y-6 md:pl-10 md:before:absolute md:before:left-[4px] md:before:top-0 md:before:bottom-0 md:before:border-l md:before:border-dashed md:before:border-[var(--color-border)]/40">
              {incidents.map((inc) => (
                <li key={inc.id} className="relative">
                  <span
                    className="hidden md:absolute md:left-[-39px] md:top-2 md:block md:size-2.5 md:rounded-full md:bg-[var(--color-border)]"
                    aria-hidden
                  />
                  <EventCard event={inc} size="md" />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Container>
  );
}
