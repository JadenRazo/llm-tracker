import type { Event } from "@/lib/db/schema";
import { cleanPreview } from "@/components/event-card";
import { getSource } from "@/components/sources";
import { getProviderMeta } from "@/lib/provider-meta";
import { isProvider, type Provider } from "@/lib/providers";
import { parseNewsRow } from "@/lib/whats-new";

export type ActivityCategory = "releases" | "news" | "docs" | "status";
export interface ActivityItem {
  id: string;
  provider: Provider;
  category: ActivityCategory;
  title: string;
  summary: string;
  timestamp: string;
  published: boolean;
  prerelease: boolean;
  sources: { label: string; url: string | null }[];
}

/** Only group the provider's own CLI sources, never unrelated SDK versions. */
export function cliVersion(
  event: Pick<Event, "provider" | "source" | "title" | "externalId">,
): string | null {
  if (
    !isProvider(event.provider) ||
    !getProviderMeta(event.provider).releaseSources.includes(event.source)
  )
    return null;
  return (
    event.title.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?/)?.[0] ??
    event.externalId.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?/)?.[0] ??
    null
  );
}

export function activityCategory(source: string): ActivityCategory {
  if (source.includes("status")) return "status";
  if (source.endsWith("news")) return "news";
  if (
    source.includes("docs") ||
    source.includes("models") ||
    source.includes("reference")
  )
    return "docs";
  if (
    source.includes("release") ||
    source.includes("npm") ||
    source.includes("changelog")
  )
    return "releases";
  return "docs";
}

/** Bounded previews and source links cross the server/client boundary, not raw bodies. */
export function buildActivity(rows: Event[]): ActivityItem[] {
  const grouped = new Map<string, ActivityItem>();
  for (const event of rows) {
    if (!isProvider(event.provider)) continue;
    const version = cliVersion(event);
    const key = version
      ? `${event.provider}:cli:${version}`
      : `${event.provider}:${event.id}`;
    const parsed =
      event.source === "anthropic_news" ? parseNewsRow(event) : null;
    const summary = cleanPreview(parsed?.summary || event.bodyMd);
    const existing = grouped.get(key);
    const source = { label: getSource(event.source).longLabel, url: event.url };
    const timestamp = (event.publishedAt ?? event.detectedAt).toISOString();
    if (existing) {
      if (
        !existing.sources.some(
          (s) => s.label === source.label && s.url === source.url,
        )
      )
        existing.sources.push(source);
      if (summary.length > existing.summary.length) existing.summary = summary;
      // Real publication dates win over ingestion time; don't make an old
      // release newly published just because another source was scraped later.
      if (
        event.publishedAt &&
        (!existing.published || timestamp < existing.timestamp)
      ) {
        existing.timestamp = timestamp;
        existing.published = true;
      } else if (
        !event.publishedAt &&
        !existing.published &&
        timestamp < existing.timestamp
      ) {
        existing.timestamp = timestamp;
      }
      existing.prerelease ||= event.type === "prerelease";
      continue;
    }
    grouped.set(key, {
      id: key,
      provider: event.provider,
      category: version ? "releases" : activityCategory(event.source),
      title: version
        ? `${getProviderMeta(event.provider).toolName} ${version}`
        : (parsed?.title ?? event.title),
      summary,
      timestamp,
      published: event.publishedAt !== null,
      prerelease:
        event.type === "prerelease" ||
        (version !== null && version.split("+")[0].includes("-")),
      sources: [source],
    });
  }
  return [...grouped.values()].sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id),
  );
}

export function filterActivity(
  items: ActivityItem[],
  provider: string,
  category: string,
  query: string,
  prereleases: boolean,
): ActivityItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (provider === "all" || item.provider === provider) &&
      (category === "all" ||
        (category === "changes"
          ? item.category !== "status"
          : item.category === category)) &&
      (prereleases || !item.prerelease) &&
      words.every((word) =>
        `${item.title} ${item.summary} ${item.provider} ${item.sources.map((s) => s.label).join(" ")}`
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
}
