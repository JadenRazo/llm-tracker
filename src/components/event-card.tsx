import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { Event } from "@/lib/db/schema";
import { getSource } from "@/components/sources";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceIcon } from "@/components/ui/source-icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { parseNewsRow } from "@/lib/whats-new";

type EventCardSize = "sm" | "md" | "lg";

/**
 * The subset of an `events` row the card actually reads. Callers that render
 * many cards (e.g. /changelog) can select just these columns instead of
 * shipping full rows; a full `Event` satisfies this structurally.
 */
export type EventCardData = Pick<
  Event,
  "id" | "source" | "type" | "title" | "url" | "bodyMd" | "publishedAt" | "detectedAt"
>;

interface EventCardProps {
  event: EventCardData;
  size?: EventCardSize;
  className?: string;
}

/**
 * Strips markdown to a plain, single-line preview. Null input returns "".
 * Not a full parser — targeted at the small subset poller bodies tend to
 * contain (headings, fences, lists, links, basic emphasis, stray HTML).
 */
export function cleanPreview(bodyMd: string | null): string {
  if (!bodyMd) return "";

  let text = bodyMd;

  // Fenced code blocks (``` ... ```), optionally with a language tag.
  text = text.replace(/```[\s\S]*?```/g, " ");

  // Inline code with backticks.
  text = text.replace(/`([^`]*)`/g, "$1");

  // Images: ![alt](url) — drop entirely.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");

  // Links: [text](url) → text.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // HTML tags.
  text = text.replace(/<\/?[^>]+>/g, " ");

  // Leading heading hashes.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Bullet markers at line start: -, *, +.
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "");

  // Numbered list markers at line start: "1.", "2)" etc.
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, "");

  // Emphasis markers (bold/italic) — strip the markers, keep the text.
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2");
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1$2");

  // Collapse all whitespace (including newlines) into single spaces.
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > 280) {
    return `${text.slice(0, 280).trimEnd()}…`;
  }
  return text;
}

/**
 * Returns the sub-type pill text, or null when it would just echo the source
 * label. Handles two patterns the pollers store:
 *   - Plain duplicate: source = "claude_code_changelog", type = "changelog",
 *     label = "changelog" → suppress (the badge already says "Changelog").
 *   - Namespaced: source = "anthropic_news", type = "news:product" →
 *     return "Product" so we keep the meaningful suffix and drop the prefix.
 */
function displayType(label: string, type: string | null): string | null {
  if (!type) return null;
  const lower = type.toLowerCase();
  const labelLower = label.toLowerCase();
  if (lower === labelLower) return null;
  const colonIdx = lower.indexOf(":");
  if (colonIdx >= 0) {
    const prefix = lower.slice(0, colonIdx);
    const suffix = type.slice(colonIdx + 1);
    if (prefix === labelLower && suffix) {
      return suffix.charAt(0).toUpperCase() + suffix.slice(1);
    }
  }
  return type;
}

const SIZE_PADDING: Record<EventCardSize, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

const SIZE_TITLE: Record<EventCardSize, string> = {
  sm: "text-display-sm",
  md: "text-display-sm",
  lg: "text-display-sm lg:text-display-md",
};

const SIZE_CLAMP: Record<EventCardSize, string> = {
  sm: "line-clamp-2",
  md: "line-clamp-3",
  lg: "line-clamp-4",
};

export function EventCard({ event, size = "md", className }: EventCardProps) {
  const meta = getSource(event.source);
  const displayTitle =
    event.source === "anthropic_news" ? parseNewsRow(event).title : event.title;
  const subType = displayType(meta.label, event.type);
  const preview = cleanPreview(event.bodyMd);
  const iconSize = size === "lg" ? "lg" : "md";
  const whenDate = event.publishedAt ?? event.detectedAt;

  return (
    <Card
      variant="raised"
      sourceKey={event.source}
      interactive
      className={clsx(
        SIZE_PADDING[size],
        size === "lg" && "border-l-[6px]",
        className,
      )}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SourceIcon sourceKey={event.source} size={iconSize} />
        <Badge variant="source" sourceKey={event.source}>
          {meta.label}
        </Badge>
        {subType ? (
          <span className="text-meta text-[var(--color-text-muted)]">{subType}</span>
        ) : null}
        <RelativeTime date={whenDate} className="ml-auto shrink-0" />
      </header>
      <h3 className={clsx(SIZE_TITLE[size], "text-[var(--color-text-primary)]")}>
        {event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-highlight)]"
          >
            {displayTitle}
            <ExternalLink
              className="ml-1 inline-block size-3.5 opacity-60"
              aria-hidden
            />
          </a>
        ) : (
          <span>{displayTitle}</span>
        )}
      </h3>
      {preview ? (
        <p
          className={clsx(
            "mt-2 text-ui-md text-[var(--color-text-secondary)]",
            SIZE_CLAMP[size],
          )}
        >
          {preview}
        </p>
      ) : null}
    </Card>
  );
}
