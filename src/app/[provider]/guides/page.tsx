import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { ChevronRight, Map } from "lucide-react";
import { listGuides } from "@/lib/content";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RelativeTime } from "@/components/ui/relative-time";
import { CategoryBadge, categoryColor } from "@/components/ui/article-header";
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
  return { title: p ? `${getProviderMeta(p).label} guides` : "Not found" };
}

export default async function GuidesPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const guides = listGuides().filter(
    (g) => g.frontmatter.provider === provider,
  );

  return (
    <Container>
      <PageHeader
        icon={Map}
        eyebrow="LONG READ"
        title="Guides"
        description={`Deep-dives, setup walkthroughs, and integration tutorials for ${meta.label}. Take the scenic route.`}
      />

      {guides.length === 0 ? (
        <EmptyState
          icon={Map}
          title={`No ${meta.label} guides yet`}
          description={`No guides have been published for ${meta.label} yet — they'll appear here as content is added.`}
          hint="Open a PR to contribute one."
        />
      ) : (
        <ul className="space-y-4">
          {guides.map((guide) => {
            const iconTint = {
              "--tint": categoryColor(guide.frontmatter.category),
            } as CSSProperties;

            return (
              <li key={guide.slug}>
                <a
                  href={`/${provider}/guides/${guide.slug}`}
                  className="block rounded-xl focus-visible:outline-none"
                >
                  <Card variant="raised" interactive>
                    <div className="flex items-start gap-4 md:gap-5">
                      <span
                        className="hidden size-11 shrink-0 items-center justify-center rounded-lg border md:inline-flex"
                        style={{
                          ...iconTint,
                          backgroundColor:
                            "color-mix(in oklab, var(--tint) 12%, transparent)",
                          borderColor:
                            "color-mix(in oklab, var(--tint) 30%, transparent)",
                          color: "var(--tint)",
                        }}
                        aria-hidden
                      >
                        <Map className="size-5" />
                      </span>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {guide.frontmatter.category ? (
                            <CategoryBadge
                              category={guide.frontmatter.category}
                            />
                          ) : null}
                          <span className="text-meta text-[var(--color-text-muted)]">
                            {guide.readingTime}
                          </span>
                          {guide.frontmatter.date ? (
                            <>
                              <span
                                className="text-meta text-[var(--color-text-muted)]"
                                aria-hidden
                              >
                                &middot;
                              </span>
                              <RelativeTime date={guide.frontmatter.date} />
                            </>
                          ) : null}
                        </div>
                        <h2 className="text-display-sm text-[var(--color-text-primary)] line-clamp-2">
                          {guide.frontmatter.title}
                        </h2>
                        {guide.frontmatter.summary ? (
                          <p className="text-ui-md text-[var(--color-text-secondary)] line-clamp-2">
                            {guide.frontmatter.summary}
                          </p>
                        ) : null}
                      </div>

                      <ChevronRight
                        className="mt-1 size-5 shrink-0 text-[var(--color-text-muted)]"
                        aria-hidden
                      />
                    </div>
                  </Card>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
