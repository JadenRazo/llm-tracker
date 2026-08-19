// Version-grouped release ladder, scoped to one provider. Merges that
// provider's npm / CHANGELOG / GitHub-release sources into one entry per
// version (Claude: claude-code; OpenAI: Codex; Gemini: gemini-cli). MDX
// bodies are pre-sanitized to neutralize bare JSX-like tokens that would
// otherwise break the prerender.

import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GitBranch, Package, Terminal } from "lucide-react";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eventRecencyDesc } from "@/lib/db/order";
import type { Event } from "@/lib/db/schema";
import { sanitizeMdx } from "@/lib/mdx-sanitize";
import { getSource } from "@/components/sources";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { DataUnavailable } from "@/components/ui/data-unavailable";
import type { LoadResult } from "@/lib/load-result";
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

// ISR — release sources are polled every 30 minutes, so a 5-minute
// revalidate window keeps the release ladder current while letting the CDN
// serve cached HTML (MDX compilation is also expensive per-request). Builds
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

/** How many version groups the ladder renders. Claude Code ships several
 * releases a week, so 50 versions is roughly the last two months — older
 * releases are one click away on npm/GitHub. Bounding this also bounds the
 * MDX compilation work per render (one compile per event per version). */
const MAX_VERSIONS = 50;

async function loadReleases(provider: Provider): Promise<LoadResult<Event>> {
  const db = tryGetDb();
  if (!db) return null;
  const sources = getProviderMeta(provider).releaseSources;
  try {
    // Fetch each source's newest rows SEPARATELY rather than taking one flat
    // recency-ordered window across all of them. A single chatty source starved
    // the others out of the window: Claude's changelog carries ~370 rows to
    // npm's ~160, so a flat LIMIT returned changelog entries almost exclusively
    // and the ladder showed no npm or GitHub rows at all. Per-source fetches
    // also make the page immune to a bulk re-ingest flattening every timestamp.
    const perSource = await Promise.all(
      sources.map((source) =>
        db
          .select()
          .from(events)
          .where(sql`${events.provider} = ${provider} and ${eq(events.source, source)}`)
          .orderBy(eventRecencyDesc)
          .limit(MAX_VERSIONS),
      ),
    );
    return perSource.flat();
  } catch {
    return null;
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

  // Order the ladder by VERSION, not by timestamp. Sorting by "newest event in
  // the group" made the order depend on when we happened to scrape each row —
  // claude_code_changelog carries no upstream publish date at all, so its groups
  // sorted by detection time and a bulk re-ingest reshuffled the whole page into
  // an arbitrary order. A release ladder that is not in version order is not a
  // ladder. Timestamp remains the tie-breaker for versions that compare equal.
  return Array.from(groups.values()).sort((a, b) => {
    const byVersion = compareVersionsDesc(a.version, b.version);
    if (byVersion !== 0) return byVersion;
    return (b.latest?.getTime() ?? 0) - (a.latest?.getTime() ?? 0);
  });
}

/**
 * SemVer-ish descending comparison. Numeric segments compare numerically;
 * a release outranks any prerelease of the same version ("0.148.0" >
 * "0.148.0-alpha.11"), and prerelease identifiers compare per SemVer §11
 * (numeric identifiers below alphanumeric ones, field by field).
 */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, ...rest] = v.split("-");
    const nums = core!.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { nums, pre: rest.join("-") };
  };
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pb.nums[i] ?? 0) - (pa.nums[i] ?? 0);
    if (d !== 0) return d;
  }

  // Same core version: a release beats a prerelease.
  if (!pa.pre && pb.pre) return -1;
  if (pa.pre && !pb.pre) return 1;
  if (!pa.pre && !pb.pre) return 0;

  const fa = pa.pre.split(".");
  const fb = pb.pre.split(".");
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const x = fa[i];
    const y = fb[i];
    if (x === undefined) return -1; // fewer fields sorts lower → later in desc
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return ny - nx;
    } else if (nx !== null) {
      return 1; // numeric identifiers have lower precedence
    } else if (ny !== null) {
      return -1;
    } else if (x !== y) {
      return x < y ? 1 : -1;
    }
  }
  return 0;
}

export default async function ReleasesPage({ params }: PageProps) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const meta = getProviderMeta(provider);
  const result = await loadReleases(provider);
  const groups = groupByVersion(result ?? []).slice(0, MAX_VERSIONS);
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

      {result === null ? (
        <DataUnavailable what="The release ladder" />
      ) : groups.length === 0 ? (
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
