// Version-grouped Claude Code release ladder. Merges npm, CHANGELOG, and
// GitHub release sources into one entry per version. MDX bodies are
// pre-sanitized to neutralize bare JSX-like tokens (e.g. `<your-custom-agent>`)
// that would otherwise break the prerender.

import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxDocComponents } from "@/components/mdx-doc-components";
import { desc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Claude Code" };
// DB-backed: the Docker build runs without DATABASE_URL, so ISR would ship an
// empty page. Force dynamic rendering to always query fresh.
export const dynamic = "force-dynamic";

async function loadReleases(): Promise<Event[]> {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(events)
      .where(
        inArray(events.source, [
          "npm_claude_code",
          "claude_code_changelog",
          "github_releases_claude_code",
        ]),
      )
      .orderBy(desc(events.publishedAt));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Version grouping
// ---------------------------------------------------------------------------

const VERSION_RE = /v?(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)/i;

/** Extracts a semver-ish version string from an event's title. Falls back to
 * externalId if the title has none. Returns null when neither matches. */
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
  /** Earliest publishedAt across the group's events. */
  date: Date | null;
  /** Most recent publishedAt — used only for sorting groups. */
  latest: Date | null;
}

/** Source display order within a group: npm first, then CHANGELOG, then GitHub. */
const SOURCE_ORDER: Record<string, number> = {
  npm_claude_code: 0,
  claude_code_changelog: 1,
  github_releases: 2,
};

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
    g.events.sort(
      (a, b) => (SOURCE_ORDER[a.source] ?? 99) - (SOURCE_ORDER[b.source] ?? 99),
    );
  }

  return Array.from(groups.values()).sort((a, b) => {
    const al = a.latest?.getTime() ?? 0;
    const bl = b.latest?.getTime() ?? 0;
    return bl - al;
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ClaudeCodePage() {
  const rows = await loadReleases();
  const groups = groupByVersion(rows);

  return (
    <Container>
      <PageHeader
        icon={Terminal}
        eyebrow="RELEASES"
        title="Claude Code"
        description="Every npm release, CHANGELOG entry, and GitHub release note from anthropics/claude-code — merged by version."
        actions={
          <>
            <a
              href="https://www.npmjs.com/package/@anthropic-ai/claude-code"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Badge variant="outline" icon={Package}>
                npm
              </Badge>
            </a>
            <a
              href="https://github.com/anthropics/claude-code/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Badge variant="outline" icon={GitBranch}>
                GitHub
              </Badge>
            </a>
          </>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title="No releases yet"
          description="The release ladder merges npm, CHANGELOG.md, and GitHub once ingest completes."
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
                      <RelativeTime date={group.date} withAbsolute className="mt-1 block" />
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
                          <ReleaseBody key={ev.id} event={ev} />
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

function ReleaseBody({ event }: { event: Event }) {
  const meta = getSource(event.source);
  return (
    <div className="rounded-md border border-[var(--color-border)]/40 bg-[color-mix(in_oklab,var(--color-surface-raised)_40%,transparent)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-meta text-[var(--color-text-muted)]">{meta.longLabel}</span>
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
          <MDXRemote
            source={sanitizeMdx(event.bodyMd)}
            components={mdxDocComponents}
          />
        </div>
      ) : (
        <p className="text-ui-sm text-[var(--color-text-muted)]">{event.title}</p>
      )}
    </div>
  );
}
