// /[provider]/models — model catalog for one provider.
//
// Only OpenAI genuinely has no catalog source (see ProviderMeta.modelsSource);
// Claude and Gemini both have working pollers, so an empty table for them means
// something is BROKEN, not "by design". The empty state must say which — it
// previously asserted "doesn't expose a machine-readable model catalog" for
// every provider, which read as a design decision while the real cause was that
// the page was serving a build-time prerender with no database.

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
import { DataUnavailable } from "@/components/ui/data-unavailable";
import type { LoadResult } from "@/lib/load-result";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { parseProviderParam } from "@/lib/provider-route";
import { getProviderMeta } from "@/lib/provider-meta";
import { cadenceForSource } from "@/lib/sources/registry";

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

// ISR — the model catalog changes a handful of times per year, so a 30-minute
// revalidate window is generous and lets the CDN serve cached HTML. Builds
// without DATABASE_URL prerender an empty fallback via tryGetDb(); the first
// runtime revalidation fills it in.
// Rendered per request (no ISR). This app runs as a Lambda container image with a
// READ-ONLY filesystem, so Next's incremental cache cannot persist a regeneration:
// any container with a cold cache served the build-time prerender, which CI produces
// with no DATABASE_URL and is therefore EMPTY. Whether a visitor saw data was a coin
// flip on container age, and CloudFront then pinned whichever answer it drew. The
// origin now always renders live DB data; the CDN owns caching via the explicit,
// bounded Cache-Control set for this path in next.config.ts.
export const dynamic = "force-dynamic";

async function loadModels(provider: Provider): Promise<LoadResult<Model>> {
  const db = tryGetDb();
  if (!db) return null;
  try {
    return await db
      .select()
      .from(models)
      .where(eq(models.provider, provider))
      .orderBy(desc(models.firstSeenAt));
  } catch {
    return null;
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
  // Cadence comes from the poller registry, never a hardcoded string: the two
  // non-Anthropic catalogs are tier 3, and this page claimed 30 minutes for all.
  const cadence = cadenceForSource(meta.modelsSource);
  const result = await loadModels(provider);
  const rows = result ?? [];

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
        description={`Every ${meta.label} model the tracker has observed, with context window and capabilities${
          cadence ? ` — polled ${cadence.long}` : ""
        }.`}
        actions={cadence ? <Badge variant="outline">{`Polled ${cadence.short}`}</Badge> : null}
      />

      <div className="space-y-6">
        {result === null ? (
          <DataUnavailable what="The model catalog" />
        ) : rows.length > 0 ? (
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
            title={
              meta.modelsSource
                ? `No ${meta.label} models ingested yet`
                : `No ${meta.label} model catalog`
            }
            description={
              meta.modelsSource
                ? `The tracker polls a ${meta.label} model catalog every 30 minutes but has no rows yet. If this persists, the ${meta.modelsSource} source is failing.`
                : `The tracker has no ${meta.label} model-catalog source it can poll, so this page stays empty by design. Release and changelog tracking is unaffected.`
            }
            hint={`See the ${meta.label} releases and changelog for model news.`}
          />
        )}
      </div>
    </Container>
  );
}
