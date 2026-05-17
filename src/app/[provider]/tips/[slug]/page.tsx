import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getTip, listTips } from "@/lib/content";
import { getCurrentClaudeCodeVersion } from "@/lib/current-cli";
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

// Only real provider×slug pairs are valid; anything else 404s at the routing
// layer with a true 404 status rather than a streamed soft-404.
export const dynamicParams = false;

export function generateStaticParams() {
  return listTips().map((t) => ({
    provider: t.frontmatter.provider,
    slug: t.slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tip = getTip(slug);
  if (!tip) return { title: "Not found" };
  return {
    title: tip.frontmatter.title,
    description: tip.frontmatter.summary,
  };
}

export default async function TipPage({ params }: PageProps) {
  const { provider: raw, slug } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const tip = getTip(slug);
  // 404 if the tip doesn't exist *or* belongs to a different provider.
  if (!tip || tip.frontmatter.provider !== provider) notFound();

  const currentCli = await getCurrentClaudeCodeVersion();
  const staleness = computeStaleness(tip.frontmatter, currentCli);

  return (
    <Container size="narrow">
      <Link
        href={`/${provider}/tips`}
        className="inline-flex items-center gap-1.5 text-ui-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-highlight)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to tips
      </Link>

      <article className="mt-6">
        <ArticleHeader
          category={tip.frontmatter.category}
          readingTime={tip.readingTime}
          date={tip.frontmatter.date}
          title={tip.frontmatter.title}
          summary={tip.frontmatter.summary}
          staleness={staleness}
        />

        <div className="prose max-w-[65ch]">
          <MDXRemote
            source={tip.body}
            components={mdxDocComponents(provider)}
          />
        </div>

        <p className="mt-12 text-meta text-[var(--color-text-muted)]">
          Sourced from content/tips/{slug}.md &mdash; open a PR to edit.
        </p>
      </article>
    </Container>
  );
}
