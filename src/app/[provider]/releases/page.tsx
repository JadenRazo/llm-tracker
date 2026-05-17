// Version-grouped release ladder, scoped to one provider. Merges that
// provider's npm / CHANGELOG / GitHub-release sources into one entry per
// version (Claude: claude-code; OpenAI: Codex; Gemini: gemini-cli). MDX
// bodies are pre-sanitized to neutralize bare JSX-like tokens that would
// otherwise break the prerender.

import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { desc, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GitBranch, Package, Terminal } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import type { Event } from "@/lib/db/schema";
import { sanitizeMdx } from "@/lib/mdx-sanitize";
import { getSource } from "@/components/sources";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RelativeTime } from "@/components/ui/relative-time";
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
  return { title: p ? `${getProviderMeta(p).toolName} releases` : "Not found" };
}

// DB-backed: the Docker build runs without DATABASE_URL, so ISR would ship an
// empty page. Force dynamic rendering to always query fresh.
export const dynamic = "force-dynamic";

async function loadReleases(provider: Provider): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  const sources = getProviderMeta(provider).releaseSources;
  try {
    return await db
      .select()
      .from(events)
      .where(
        sql`${events.provider} = ${provider} and ${inArray(events.source, [...sources])}`,
      )
      .orderBy(desc(events.publishedAt));
  } catch {
    return [];
  }
}

const VERSION_RE = /v?(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)/i;

function extractVersion(ev: Event): string | null {
  const fromTitle = ev.title.match(VERSION_RE);
  if (fromTitle) return fromTitle[1];
  const fromExternal = ev.externalId?.match(VERSION_RE);
  if (fromExternal) return fromExternal[1];
  return null;
}

interface ReleaseGroup {
  version: string;
  events: Event[];
  date: Date | null;
  latest: Date | null;
}

/** Source display order within a group: npm first, then CHANGELOG, then GitHub. */
function sourceRank(source: string): number {
  if (source.includes("npm")) return 0;
  if (source.includes("changelog")) return 1;
  return 2;
}

function groupByVersion(rows: Event[]): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>();

  for (const ev of rows) {
    const version = extractVersion(ev);
    if (!version) continue;

    const existing = groups.get(version);
    const published = ev.publishedAt ?? ev.detectedAt;

    if (!existing) {
      groups.set(version, {
        version,
        events: [ev],
        date: published,
        latest: published,
      });
      continue;
    }

    existing.events.push(ev);
    if (published) {
      if (!existing.date || published.getTime() < existing.date.getTime()) {
        existing.date = published;
      }
      if (!existing.latest || published.getTime() > existing.latest.getTime()) {
        existing.latest = published;
      }
    }
  }

  for (const g of groups.values()) {
    g.events.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  }

  return Array.from(groups.values()).sort((a, b) => {
    const al = a.latest?.getTime() ?? 0;
    const bl = b.latest?.getTime() ?? 0;
    return bl - al;
  });
}

export default async function ReleasesPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const rows = await loadReleases(provider);
  const groups = groupByVersion(rows);
  const components = mdxDocComponents(provider);

  return (
    <Container>
      <PageHeader
        icon={Terminal}
        eyebrow="RELEASES"
        title={meta.toolName}
        description={`Every npm release, CHANGELOG entry, and GitHub release note for ${meta.toolName} — merged by version.`}
        actions={
          <>
            {meta.releaseLinks.map((link, i) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Badge variant="outline" icon={i === 0 ? Package : GitBranch}>
                  {link.label}
                </Badge>
              </a>
            ))}
          </>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title="No releases yet"
          description="The release ladder merges npm, CHANGELOG, and GitHub once ingest completes."
          hint="Polled every 30 minutes."
        />
      ) : (
        <ol className="space-y-6 animate-in">
          {groups.map((group) => {
            const distinctSources = Array.from(
              new Set(group.events.map((e) => e.source)),
            );
            return (
              <li key={group.version}>
                <Card variant="raised">
                  <div className="flex flex-col gap-5 md:flex-row md:gap-6">
                    <div className="hidden w-[140px] shrink-0 md:block">
                      <h2 className="text-display-lg font-mono text-[var(--color-text-primary)]">
                        v{group.version}
                      </h2>
                      <RelativeTime
                        date={group.date}
                        withAbsolute
                        className="mt-1 block"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-4 flex flex-wrap items-center gap-2 md:hidden">
                        <h2 className="text-display-md font-mono text-[var(--color-text-primary)]">
                          v{group.version}
                        </h2>
                        <RelativeTime date={group.date} withAbsolute />
                      </div>

                      <div className="mb-4 flex flex-wrap gap-1.5">
                        {distinctSources.map((src) => (
                          <Badge key={src} variant="source" sourceKey={src}>
                            {getSource(src).label}
                          </Badge>
                        ))}
                      </div>

                      <div className="space-y-4">
                        {group.events.map((ev) => (
                          <ReleaseBody
                            key={ev.id}
                            event={ev}
                            components={components}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </Container>
  );
}

function ReleaseBody({
  event,
  components,
}: {
  event: Event;
  components: ReturnType<typeof mdxDocComponents>;
}) {
  const meta = getSource(event.source);
  return (
    <div className="rounded-md border border-[var(--color-border)]/40 bg-[color-mix(in_oklab,var(--color-surface-raised)_40%,transparent)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-meta text-[var(--color-text-muted)]">
          {meta.longLabel}
        </span>
        {event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-meta text-[var(--color-highlight)] hover:underline"
          >
            source ↗
          </a>
        ) : null}
      </div>
      {event.bodyMd ? (
        <div className="prose prose-sm max-w-none">
          <MDXRemote source={sanitizeMdx(event.bodyMd)} components={components} />
        </div>
      ) : (
        <p className="text-ui-sm text-[var(--color-text-muted)]">{event.title}</p>
      )}
    </div>
  );
}
