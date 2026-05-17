import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Clock, Database, Sparkles } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { models } from "@/lib/db/schema";
import type { Model } from "@/lib/db/schema";
import { ModelTable } from "@/components/model-table";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";

export const metadata: Metadata = { title: "Models" };
// DB-backed: force dynamic so the page always has live content (the Docker
// build runs without DATABASE_URL and would otherwise ship an empty cache).
export const dynamic = "force-dynamic";

async function loadModels(): Promise<Model[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return await db.select().from(models).orderBy(desc(models.firstSeenAt));
  } catch {
    return [];
  }
}

function formatContext(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toString();
}

function daysAgo(date: Date | null): string {
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export default async function ModelsPage() {
  const rows = await loadModels();

  const largestContext = rows.reduce<number | null>((acc, m) => {
    if (m.contextWindow === null || m.contextWindow === undefined) return acc;
    if (acc === null || m.contextWindow > acc) return m.contextWindow;
    return acc;
  }, null);

  const newestFirstSeen = rows.reduce<Date | null>((acc, m) => {
    if (!m.firstSeenAt) return acc;
    if (!acc || m.firstSeenAt.getTime() > acc.getTime()) return m.firstSeenAt;
    return acc;
  }, null);

  return (
    <Container>
      <PageHeader
        icon={Sparkles}
        eyebrow="CATALOG"
        title="Models"
        description="Every Claude model on the Anthropic API, with context window and capabilities — polled every 30 minutes."
        actions={<Badge variant="outline">Polled every 30 min</Badge>}
      />

      <div className="space-y-6">
        {rows.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 animate-in sm:grid-cols-3">
            <Stat
              icon={Sparkles}
              label="Models in catalog"
              value={rows.length}
              hint="listed on api.anthropic.com"
            />
            <Stat
              icon={Database}
              label="Largest context"
              value={formatContext(largestContext)}
              hint="tokens per request"
            />
            <Stat
              icon={Clock}
              label="Newest addition"
              value={daysAgo(newestFirstSeen)}
              hint="by first-seen date"
            />
          </section>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Catalog warming up"
            description="The models poller runs every 30 minutes."
            hint="First population typically completes within 30 minutes of deploy."
          />
        ) : (
          <section className="animate-in">
            <ModelTable models={rows} />
          </section>
        )}
      </div>
    </Container>
  );
}
