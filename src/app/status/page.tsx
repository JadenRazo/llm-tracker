// /status — Anthropic service status and incident history.
//
// Renders a full-width hero card whose tint reflects the current operational
// state, followed by a vertical, dotted-rail timeline of recent incidents.
// Data shape is unchanged from the original page; only layout and primitives
// were redesigned for Phase C.

import { and, desc, eq, ne } from "drizzle-orm";
import { MDXRemote } from "next-mdx-remote/rsc";
import { Activity, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import type { Event } from "@/lib/db/schema";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { EventCard } from "@/components/event-card";

export const metadata: Metadata = { title: "Status" };
// DB-backed: force dynamic so the page always has live content (the Docker
// build runs without DATABASE_URL and would otherwise ship an empty cache).
export const dynamic = "force-dynamic";

type StatusTone = "operational" | "degraded" | "outage" | "neutral";

interface ToneMeta {
  /** CSS color expression for the accent border + dot. */
  color: string;
  /** Human label shown in the hero. */
  label: string;
  /** Dot pulses when the service isn't fully operational. */
  pulse: boolean;
}

const TONE_META: Record<StatusTone, ToneMeta> = {
  operational: { color: "var(--color-leaf)", label: "Operational", pulse: false },
  degraded: { color: "var(--color-adobe)", label: "Degraded", pulse: true },
  outage: { color: "var(--color-terra)", label: "Major outage", pulse: true },
  neutral: { color: "var(--color-text-muted)", label: "Unknown", pulse: false },
};

/**
 * Case-insensitive substring match against a status title, mapped to one of
 * four tones. Priority order: outage > degraded > operational > neutral.
 */
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

async function loadStatus(): Promise<{ current: Event | null; incidents: Event[] }> {
  const db = tryGetDb();
  if (!db) return { current: null, incidents: [] };
  try {
    const [currentRows, incidentRows] = await Promise.all([
      db
        .select()
        .from(events)
        .where(and(eq(events.source, "anthropic_status"), eq(events.externalId, "current")))
        .limit(1),
      db
        .select()
        .from(events)
        .where(and(eq(events.source, "anthropic_status"), ne(events.externalId, "current")))
        .orderBy(desc(events.publishedAt))
        .limit(50),
    ]);
    return { current: currentRows[0] ?? null, incidents: incidentRows };
  } catch {
    return { current: null, incidents: [] };
  }
}

export default async function StatusPage() {
  const { current, incidents } = await loadStatus();
  const tone = classifyStatus(current?.title);
  const meta = TONE_META[tone];

  return (
    <Container>
      <PageHeader
        icon={Activity}
        eyebrow="UPTIME"
        title="Anthropic status"
        description="Live system status and recent incidents from status.claude.com. Polled every 10 minutes."
      />

      <div className="space-y-[var(--space-section)]">
        <section className="animate-in">
          {current ? (
            // `--tone` is declared on the outer wrapper so every descendant —
            // border, dot, any future accent — can read a single variable.
            <div style={{ ["--tone" as string]: meta.color }}>
              <Card
                variant="raised"
                className="border-l-[6px] border-l-[var(--tone)] p-5 sm:p-6 md:p-8"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={
                      "inline-block size-2.5 rounded-full" +
                      (meta.pulse ? " animate-pulse-dot" : "")
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
                    <MDXRemote source={current.bodyMd} />
                  </div>
                ) : null}
              </Card>
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Status stream warming up"
              description="No status snapshot has landed yet."
              hint="status.claude.com is polled every 10 minutes."
            />
          )}
        </section>

        <section className="animate-in">
          <SectionHeading
            eyebrow="HISTORY"
            title="Recent incidents"
            count={incidents.length}
          />
          {incidents.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="All clear"
              description="No incidents recorded yet."
              hint="Polled every 10 minutes — anything new will show up here first."
            />
          ) : (
            // Vertical timeline. The dotted rail is drawn by a single
            // `before:` pseudo-element on the <ol>; each <li> carries an
            // absolute-positioned dot that sits on the rail at md+.
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
