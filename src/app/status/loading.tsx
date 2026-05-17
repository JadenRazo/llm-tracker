// Loading fallback for /status. Mirrors: PageHeader + full-width status hero +
// 4 incident row skeletons.

import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function StatusLoading() {
  return (
    <Container>
      <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border)]/60 pb-6 sm:flex-row sm:items-start sm:gap-5">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </header>

      <div className="space-y-[var(--space-section)]">
        <div className="rounded-xl border border-l-[6px] border-[var(--color-border)] bg-[var(--color-surface-raised)] p-8">
          <div className="flex items-center gap-3">
            <Skeleton className="size-2.5 rounded-full" />
            <Skeleton className="h-6 w-56" />
          </div>
          <Skeleton className="mt-3 h-3 w-40" />
          <div className="mt-4 space-y-2 border-t border-[var(--color-border)]/40 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>

        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </Container>
  );
}
