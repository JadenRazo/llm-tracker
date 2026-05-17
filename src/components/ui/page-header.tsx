import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

/**
 * Consistent header block for every non-home page.
 * Layout: optional icon chip | (eyebrow, title, description) | optional actions.
 * Bottom-bordered for visual separation from page content.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={clsx(
        "mb-6 flex flex-col gap-3 border-b border-[var(--color-border)]/60 pb-5 sm:mb-8 sm:flex-row sm:items-start sm:gap-5 sm:pb-6",
        className,
      )}
    >
      {Icon ? (
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]"
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="flex-1 min-w-0">
        {eyebrow ? (
          <p className="text-meta text-[var(--color-text-muted)]">{eyebrow}</p>
        ) : null}
        <h1 className="text-display-md text-[var(--color-text-primary)] sm:text-display-lg">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-ui-md text-[var(--color-text-secondary)] sm:text-ui-lg">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 sm:ml-auto sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}
