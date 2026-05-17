import { clsx } from "clsx";
import type { ReactNode } from "react";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  /** When set, renders a small neutral pill next to the title. */
  count?: number | string;
  /** Right-aligned slot (e.g. a "view all" link). */
  action?: ReactNode;
  className?: string;
}

/**
 * Section-level heading. Use inside a page below PageHeader.
 */
export function SectionHeading({
  eyebrow,
  title,
  count,
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div className={clsx("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-meta text-[var(--color-text-muted)]">{eyebrow}</p>
        ) : null}
        <div className="flex items-baseline gap-3">
          <h2 className="text-display-md text-[var(--color-text-primary)]">{title}</h2>
          {count !== undefined && count !== null ? (
            <span className="inline-flex items-center rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 text-meta text-[var(--color-text-secondary)]">
              {count}
            </span>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
