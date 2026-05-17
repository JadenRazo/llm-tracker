import type { Metadata } from "next";
import { Lightbulb } from "lucide-react";
import { listTips } from "@/lib/content";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RelativeTime } from "@/components/ui/relative-time";
import { CategoryBadge } from "@/components/ui/article-header";

export const metadata: Metadata = { title: "Tips" };

export default function TipsPage() {
  const tips = listTips();

  return (
    <Container>
      <PageHeader
        icon={Lightbulb}
        eyebrow="POWER USERS"
        title="Tips"
        description="Short, high-leverage patterns for Claude and Claude Code. Curated, MDX-backed, deployable."
      />

      {tips.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No tips yet"
          description="The tips library is still being seeded from content/tips/*.md."
          hint="Open a PR to contribute one."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tips.map((tip) => (
            <li key={tip.slug} className="h-full">
              <a
                href={`/tips/${tip.slug}`}
                className="block h-full rounded-xl focus-visible:outline-none"
              >
                <Card variant="raised" interactive className="h-full flex flex-col gap-3">
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
