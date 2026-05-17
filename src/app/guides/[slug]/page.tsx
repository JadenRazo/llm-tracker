import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getGuide, listGuides } from "@/lib/content";
import { getCurrentClaudeCodeVersion } from "@/lib/current-cli";
import { computeStaleness } from "@/lib/staleness";
import { ArticleHeader } from "@/components/ui/article-header";
import { Container } from "@/components/ui/container";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// ISR every 5 min — staleness reads getCurrentClaudeCodeVersion() which has
// its own 5-min in-process cache, so requests within a revalidation window
// hit Next's page cache instead of re-rendering MDX + querying the DB.
export const revalidate = 300;

export async function generateStaticParams() {
  return listGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return { title: "Not found" };
  return {
    title: guide.frontmatter.title,
    description: guide.frontmatter.summary,
  };
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const currentCli = await getCurrentClaudeCodeVersion();
  const staleness = computeStaleness(guide.frontmatter, currentCli);

  return (
    <Container size="narrow">
      <Link
        href="/guides"
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
          <MDXRemote source={guide.body} components={mdxDocComponents} />
        </div>

        <p className="mt-12 text-meta text-[var(--color-text-muted)]">
          Sourced from content/guides/{slug}.md &mdash; open a PR to edit.
        </p>
      </article>
    </Container>
  );
}
