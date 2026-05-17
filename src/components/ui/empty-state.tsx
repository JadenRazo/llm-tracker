import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Calm, centered zero-data state. Use anywhere a list/grid renders empty
 * instead of a raw "No X yet" fallback.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center py-16 text-center",
        className,
      )}
    >
      <Icon
        className="mb-4 size-8 text-[var(--color-text-muted)]"
        strokeWidth={1.5}
        aria-hidden
      />
      <h3 className="text-display-sm text-[var(--color-text-primary)]">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-ui-md text-[var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
      {hint ? (
        <p className="mt-3 text-meta text-[var(--color-text-muted)]">{hint}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
