// /changelog — unified event feed across every source, grouped by ISO week.
//
// Top of page: a non-interactive chip row showing per-source counts so users
// can see at a glance which sources are active this window. Below: week blocks
// (Monday-starting) rendered most-recent-first as a 2-column small-card grid.

import { desc } from "drizzle-orm";
import { Package } from "lucide-react";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Changelog" };
// ISR — the fastest poller runs every 5 minutes, so a 5-minute revalidate
// window never lags ingest by more than one cycle and lets the CDN serve
// cached HTML. Builds without DATABASE_URL prerender an empty fallback via
// tryGetDb(); the first runtime revalidation fills it in.
export const revalidate = 300;

async function loadAll(): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return await db.select().from(events).orderBy(desc(events.publishedAt)).limit(200);
  } catch {
    return [];
  }
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Returns the Monday 00:00 UTC at or before `date`. ISO weeks start on
 * Monday; using UTC keeps bucketing stable across server timezones.
 */
function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  // getUTCDay() returns 0 (Sun) .. 6 (Sat). Shift so Monday = 0.
  const dayIndex = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d;
}

/**
 * Groups events by their Monday-starting ISO week, sorted most-recent-first.
 */
function groupByWeek(rows: Event[]): Array<{ weekStart: Date; events: Event[] }> {
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

/** "Apr 14" — month + day, no year. */
function formatShort(date: Date): string {
  return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * "Apr 14 – Apr 20, 2026". The trailing year is omitted when the week
 * ends in the current calendar year.
 */
function formatRange(weekStart: Date, currentYear: number): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const endYear = end.getUTCFullYear();
  const base = `${formatShort(weekStart)} – ${formatShort(end)}`;
  return endYear === currentYear ? base : `${base}, ${endYear}`;
}

/**
 * Counts events per source, preserving insertion order so the chip row
 * reflects the order sources first appear in the feed (most recent first).
 */
function countBySource(rows: Event[]): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([source, count]) => ({ source, count }));
}

export default async function ChangelogPage() {
  const rows = await loadAll();
  const weeks = groupByWeek(rows);
  const currentYear = new Date().getUTCFullYear();
  const sourceCounts = countBySource(rows);

  return (
    <Container>
      <PageHeader
        icon={Package}
        eyebrow="EVERYTHING"
        title="Changelog"
        description="Every release, doc update, and news item across the Claude ecosystem. Deduped and sorted by publish date."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No events yet"
          description="Nothing has been ingested from any source so far."
          hint="Pollers run every 5–30 minutes depending on the source."
        />
      ) : (
        <>
          {/* Display-only source filter row — interactive filtering is a later phase. */}
          <div className="mb-8 flex flex-wrap gap-2">
            {sourceCounts.map(({ source, count }) => {
              const meta = getSource(source);
              const Icon = meta.icon;
              return (
                <Badge key={source} variant="source" sourceKey={source}>
                  <Icon className="size-3" aria-hidden />
                  <span>{meta.label}</span>
                  <span className="opacity-70">{count}</span>
                </Badge>
              );
            })}
          </div>

          <div className="space-y-[var(--space-section)]">
            {weeks.map(({ weekStart, events: weekEvents }) => (
              <section
                key={weekStart.toISOString()}
                className="animate-in"
              >
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
