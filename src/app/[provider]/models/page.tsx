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
import { Boxes } from "lucide-react";
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

  return (
    <Container>
      <PageHeader
        icon={Boxes}
        eyebrow={`${meta.label} / Catalog`}
        title={`${meta.label} models`}
        description="Search by name or documented capability, then sort by context size. Copy the exact model ID for your next project."
        actions={
          cadence ? (
            <Badge variant="outline">{`Polled ${cadence.short}`}</Badge>
          ) : null
        }
      />

      <div className="space-y-6">
        {result === null ? (
          <DataUnavailable what="The model catalog" />
        ) : rows.length > 0 ? (
          <>
            <section className="animate-in">
              <ModelTable key={provider} models={rows} />
              <p className="mt-5 max-w-3xl text-ui-md leading-relaxed text-[var(--color-text-muted)]">
                Capabilities reflect the provider’s documented data. Missing
                details mean unknown, not unsupported. “First tracked” is when
                this tracker recorded the model, not its release date.
              </p>
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
                ? `No models are recorded for ${meta.label} yet. Check the provider’s releases for model announcements.`
                : `The tracker has no ${meta.label} model-catalog source it can poll, so this page stays empty by design. Release and changelog tracking is unaffected.`
            }
            hint={`See the ${meta.label} releases and changelog for model news.`}
          />
        )}
      </div>
    </Container>
  );
}
