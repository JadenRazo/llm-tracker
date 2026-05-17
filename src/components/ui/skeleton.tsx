import { clsx } from "clsx";

interface SkeletonProps {
  className?: string;
}

/**
 * Base shimmer block. Height and width are expected to come from className
 * overrides; default gives a single-line look.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={clsx("h-4 w-full rounded animate-shimmer", className)}
    />
  );
}

/** Card-shaped placeholder matching the standard `<Card>` footprint. */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
        className,
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-5 w-3/4" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-5/6" />
    </div>
  );
}

/** Single-line row placeholder. */
export function SkeletonRow({ className }: SkeletonProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        className,
      )}
    >
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/** Stat-sized placeholder. */
export function SkeletonStat({ className }: SkeletonProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
        className,
      )}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-8 w-24" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  );
}
