import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { listTips } from "@/lib/content";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RelativeTime } from "@/components/ui/relative-time";
import { CategoryBadge } from "@/components/ui/article-header";
import { PROVIDERS } from "@/lib/providers";
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
  return { title: p ? `${getProviderMeta(p).label} tips` : "Not found" };
}

export default async function TipsPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const tips = listTips().filter((t) => t.frontmatter.provider === provider);

  return (
    <Container>
      <PageHeader
        icon={Lightbulb}
        eyebrow="POWER USERS"
        title="Tips"
        description={`Short, high-leverage patterns for ${meta.label} and ${meta.toolName}. Curated, MDX-backed, deployable.`}
      />

      {tips.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={`No ${meta.label} tips yet`}
          description={`No tips have been published for ${meta.label} yet — they'll appear here as content is added.`}
          hint="Open a PR to contribute one."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tips.map((tip) => (
            <li key={tip.slug} className="h-full">
              <a
                href={`/${provider}/tips/${tip.slug}`}
                className="block h-full rounded-xl focus-visible:outline-none"
              >
                <Card
                  variant="raised"
                  interactive
                  className="h-full flex flex-col gap-3"
                >
                  <div className="flex items-center">
                    {tip.frontmatter.category ? (
                      <CategoryBadge category={tip.frontmatter.category} />
                    ) : (
                      <span />
                    )}
                  </div>
                  <h2 className="text-display-sm text-[var(--color-text-primary)] line-clamp-2">
                    {tip.frontmatter.title}
                  </h2>
                  {tip.frontmatter.summary ? (
                    <p className="text-ui-md text-[var(--color-text-secondary)] line-clamp-2">
                      {tip.frontmatter.summary}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-2 text-meta text-[var(--color-text-muted)]">
                    <RelativeTime date={tip.frontmatter.date ?? null} />
                    <span>{tip.readingTime}</span>
                  </div>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
