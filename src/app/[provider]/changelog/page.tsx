// /[provider]/changelog — unified event feed for one provider, grouped by
// ISO week. Top: a non-interactive per-source count chip row. Below: week
// blocks (Monday-starting) rendered most-recent-first as a 2-col card grid.

import { desc, eq } from "drizzle-orm";
import { Package } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import type { Event } from "@/lib/db/schema";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/event-card";
import { getSource } from "@/components/sources";
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
  return { title: p ? `${getProviderMeta(p).label} changelog` : "Not found" };
}

// DB-backed: force dynamic so the page always has live content (the Docker
// build runs without DATABASE_URL and would otherwise ship an empty cache).
export const dynamic = "force-dynamic";

async function loadAll(provider: Provider): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(events)
      .where(eq(events.provider, provider))
      .orderBy(desc(events.publishedAt))
      .limit(200);
  } catch {
    return [];
  }
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function startOfIsoWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayIndex = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d;
}

function groupByWeek(
  rows: Event[],
): Array<{ weekStart: Date; events: Event[] }> {
  const buckets = new Map<number, { weekStart: Date; events: Event[] }>();
  for (const row of rows) {
    const when = row.publishedAt ?? row.detectedAt;
    const start = startOfIsoWeek(when);
    const key = start.getTime();
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.events.push(row);
    } else {
      buckets.set(key, { weekStart: start, events: [row] });
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
  );
}

function formatShort(date: Date): string {
  return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatRange(weekStart: Date, currentYear: number): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const endYear = end.getUTCFullYear();
  const base = `${formatShort(weekStart)} – ${formatShort(end)}`;
  return endYear === currentYear ? base : `${base}, ${endYear}`;
}

function countBySource(
  rows: Event[],
): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([source, count]) => ({
    source,
    count,
  }));
}

export default async function ChangelogPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const rows = await loadAll(provider);
  const weeks = groupByWeek(rows);
  const currentYear = new Date().getUTCFullYear();
  const sourceCounts = countBySource(rows);

  return (
    <Container>
      <PageHeader
        icon={Package}
        eyebrow="EVERYTHING"
        title="Changelog"
        description={`Every release, doc update, and news item across the ${meta.label} ecosystem. Deduped and sorted by publish date.`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No events yet"
          description={`Nothing has been ingested from any ${meta.label} source so far.`}
          hint="Pollers run every 5–30 minutes depending on the source."
        />
      ) : (
        <>
          <div className="mb-8 flex flex-wrap gap-2">
            {sourceCounts.map(({ source, count }) => {
              const sm = getSource(source);
              const Icon = sm.icon;
              return (
                <Badge key={source} variant="source" sourceKey={source}>
                  <Icon className="size-3" aria-hidden />
                  <span>{sm.label}</span>
                  <span className="opacity-70">{count}</span>
                </Badge>
              );
            })}
          </div>

          <div className="space-y-[var(--space-section)]">
            {weeks.map(({ weekStart, events: weekEvents }) => (
              <section key={weekStart.toISOString()} className="animate-in">
                <SectionHeading
                  eyebrow={`WEEK OF ${formatShort(weekStart)}`}
                  title={formatRange(weekStart, currentYear)}
                  count={weekEvents.length}
                />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {weekEvents.map((e) => (
                    <EventCard key={e.id} event={e} size="sm" />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Container>
  );
}
