import { clsx } from "clsx";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import type { StalenessResult } from "@/lib/staleness";

/**
 * Category -> CSS variable name from the existing earth/forest palette.
 * Values are already-defined tokens in globals.css; no new colors.
 * Unknown categories fall through to a neutral border tint.
 */
const CATEGORY_COLOR: Record<string, string> = {
  workflow: "var(--color-sage)",
  performance: "var(--color-gold)",
  debugging: "var(--color-terra)",
  setup: "var(--color-moss)",
  prompting: "var(--color-adobe)",
};

export function categoryColor(category: string | undefined | null): string {
  if (!category) return "var(--color-border)";
  return CATEGORY_COLOR[category.toLowerCase()] ?? "var(--color-border)";
}

interface CategoryBadgeProps {
  category: string | undefined | null;
  className?: string;
}

/**
 * Inline `--tint`-driven badge for content categories (tips + guides).
 * Mirrors the color-mix pattern used by `Badge variant="source"` without
 * needing a source key, so category tint is decoupled from poller sources.
 */
export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  if (!category) return null;
  const style = { "--tint": categoryColor(category) } as CSSProperties;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-meta",
        "bg-[color-mix(in_oklab,var(--tint)_14%,transparent)]",
        "text-[var(--tint)]",
        "border-[color-mix(in_oklab,var(--tint)_30%,transparent)]",
        className,
      )}
      style={style}
    >
      {category}
    </span>
  );
}

interface ArticleHeaderProps {
  category?: string;
  readingTime: string;
  date?: string;
  title: string;
  summary?: string;
  staleness?: StalenessResult;
  className?: string;
}

function StalenessBadge({ result }: { result: StalenessResult }) {
  if (result.status === "unknown") return null;
  if (result.status === "fresh") {
    return (
      <Badge variant="status" tone="fresh">
        Verified on Claude Code {result.verifiedAgainstCli}
      </Badge>
    );
  }
  const whatChanged =
    result.reason === "version"
      ? `current is ${result.currentCliVersion}`
      : result.reason === "age"
        ? `verified ${result.verifiedAt}`
        : `verified ${result.verifiedAt}, current is ${result.currentCliVersion}`;
  return (
    <Badge variant="status" tone="stale">
      May be stale — verified against {result.verifiedAgainstCli} · {whatChanged}
    </Badge>
  );
}

/**
 * Consistent article header for /tips/[slug] and /guides/[slug]. Renders
 * a meta row (category, reading time, relative date) above the h1 and
 * summary lead, finished with a subtle bottom divider.
 */
export function ArticleHeader({
  category,
  readingTime,
  date,
  title,
  summary,
  staleness,
  className,
}: ArticleHeaderProps) {
  return (
    <header className={clsx("mb-8 pb-8 border-b border-[var(--color-border)]/40", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {category ? <CategoryBadge category={category} /> : null}
        <span className="text-meta text-[var(--color-text-muted)]">{readingTime}</span>
        {date ? (
          <>
            <span className="text-meta text-[var(--color-text-muted)]" aria-hidden>
              &middot;
            </span>
            <RelativeTime date={date} />
          </>
        ) : null}
        {staleness ? <StalenessBadge result={staleness} /> : null}
      </div>
      <h1 className="mt-4 text-display-lg text-[var(--color-text-primary)]">{title}</h1>
      {summary ? (
        <p className="mt-3 text-ui-lg text-[var(--color-text-secondary)]">{summary}</p>
      ) : null}
    </header>
  );
}
