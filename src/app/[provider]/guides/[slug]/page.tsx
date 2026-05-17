import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getGuide, listGuides } from "@/lib/content";
import { getCurrentCliVersion } from "@/lib/current-cli";
import { computeStaleness } from "@/lib/staleness";
import { ArticleHeader } from "@/components/ui/article-header";
import { Container } from "@/components/ui/container";
import { parseProviderParam } from "@/lib/provider-route";

interface PageProps {
  params: Promise<{ provider: string; slug: string }>;
}

// ISR every 5 min — staleness reads getCurrentClaudeCodeVersion() which has
// its own 5-min in-process cache, so requests within a revalidation window
// hit Next's page cache instead of re-rendering MDX + querying the DB.
export const revalidate = 300;

// Only real provider×slug pairs are valid; anything else (unknown slug, or a
// slug whose content belongs to a different provider) 404s at the routing
// layer with a true 404 status rather than a streamed soft-404.
export const dynamicParams = false;

export function generateStaticParams() {
  return listGuides().map((g) => ({
    provider: g.frontmatter.provider,
    slug: g.slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { provider: raw, slug } = await params;
  const provider = parseProviderParam(raw);
  const guide = getGuide(slug);
  if (!guide || !provider || guide.frontmatter.provider !== provider)
    return { title: "Not found" };
  return {
    title: guide.frontmatter.title,
    description: guide.frontmatter.summary,
  };
}

export default async function GuidePage({ params }: PageProps) {
  const { provider: raw, slug } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const guide = getGuide(slug);
  // 404 if the guide doesn't exist *or* belongs to a different provider —
  // keeps each provider's content namespace clean.
  if (!guide || guide.frontmatter.provider !== provider) notFound();

  const currentCli = await getCurrentCliVersion(provider);
  const staleness = computeStaleness(guide.frontmatter, currentCli);

  return (
    <Container size="narrow">
      <Link
        href={`/${provider}/guides`}
        className="inline-flex items-center gap-1.5 text-ui-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-highlight)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to guides
      </Link>

      <article className="mt-6">
        <ArticleHeader
          category={guide.frontmatter.category}
          readingTime={guide.readingTime}
          date={guide.frontmatter.date}
          title={guide.frontmatter.title}
          summary={guide.frontmatter.summary}
          staleness={staleness}
        />

        <div className="prose max-w-[65ch]">
          <MDXRemote
            source={guide.body}
            components={mdxDocComponents(provider)}
          />
        </div>

        <p className="mt-12 text-meta text-[var(--color-text-muted)]">
          Sourced from content/guides/{slug}.md &mdash; open a PR to edit.
        </p>
      </article>
    </Container>
  );
}
