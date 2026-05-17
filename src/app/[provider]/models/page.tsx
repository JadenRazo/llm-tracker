// /[provider]/models — model catalog for one provider. OpenAI has no model
// rows by design (no canonical machine-readable catalog source); that path
// renders a tasteful empty state rather than crashing.

import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Boxes, Clock, Database } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { models } from "@/lib/db/schema";
import type { Model } from "@/lib/db/schema";
import { ModelTable } from "@/components/model-table";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
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
  return { title: p ? `${getProviderMeta(p).label} models` : "Not found" };
}

// DB-backed: force dynamic so the page always has live content (the Docker
// build runs without DATABASE_URL and would otherwise ship an empty cache).
export const dynamic = "force-dynamic";

async function loadModels(provider: Provider): Promise<Model[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(models)
      .where(eq(models.provider, provider))
      .orderBy(desc(models.firstSeenAt));
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

export default async function ModelsPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const rows = await loadModels(provider);

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
        icon={Boxes}
        eyebrow="CATALOG"
        title="Models"
        description={`Every ${meta.label} model the tracker has observed, with context window and capabilities — polled every 30 minutes.`}
        actions={<Badge variant="outline">Polled every 30 min</Badge>}
      />

      <div className="space-y-6">
        {rows.length > 0 ? (
          <>
            <section className="grid grid-cols-1 gap-4 animate-in sm:grid-cols-3">
              <Stat
                icon={Boxes}
                label="Models in catalog"
                value={rows.length}
                hint={`tracked for ${meta.label}`}
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
            <section className="animate-in">
              <ModelTable models={rows} />
            </section>
          </>
        ) : (
          <EmptyState
            icon={Boxes}
            title={`No ${meta.label} model catalog`}
            description={`${meta.label} doesn't expose a machine-readable model catalog the tracker can poll, so this page stays empty by design. Release and changelog tracking is unaffected.`}
            hint={`See the ${meta.label} releases and changelog for model news.`}
          />
        )}
      </div>
    </Container>
  );
}
