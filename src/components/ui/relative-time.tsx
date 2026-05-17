import { clsx } from "clsx";

interface RelativeTimeProps {
  /** Accepts Date, ISO string, or null. Null → empty <time /> placeholder. */
  date: Date | string | null | undefined;
  className?: string;
  /** When true, prefix the absolute short date for entries <7d old:
   *  "Apr 23 · 2d ago". Older entries already render as the absolute date,
   *  so they are unchanged. */
  withAbsolute?: boolean;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Best-effort human-readable relative time. Rendered once on the server —
 * values will feel correct as long as the page is reasonably fresh (the
 * tracker revalidates every 60s).
 */
function formatRelativeParts(
  date: Date,
  now: Date = new Date(),
): { relative: string; isRelative: boolean } {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 60) return { relative: "Just now", isRelative: true };
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return { relative: `${diffMin}m ago`, isRelative: true };
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return { relative: `${diffHr}h ago`, isRelative: true };
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return { relative: `${diffDay}d ago`, isRelative: true };

  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const absolute = sameYear
    ? `${month} ${day}`
    : `${month} ${day}, ${date.getUTCFullYear()}`;
  return { relative: absolute, isRelative: false };
}

function shortAbsolute(date: Date, now: Date = new Date()): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return sameYear
    ? `${month} ${day}`
    : `${month} ${day}, ${date.getUTCFullYear()}`;
}

/**
 * Server component: emits a semantic <time> element with the ISO datetime
 * in `dateTime`, the full ISO in `title` (hover tooltip), and a relative
 * human-readable label as body text.
 */
export function RelativeTime({
  date,
  className,
  withAbsolute,
}: RelativeTimeProps) {
  if (date === null || date === undefined) {
    return <time className={className} />;
  }

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return <time className={className} />;
  }

  const iso = d.toISOString();
  const parts = formatRelativeParts(d);
  const label =
    withAbsolute && parts.isRelative
      ? `${shortAbsolute(d)} · ${parts.relative}`
      : parts.relative;
  return (
    <time
      dateTime={iso}
      title={iso}
      className={clsx("text-meta text-[var(--color-text-muted)]", className)}
    >
      {label}
    </time>
  );
}
