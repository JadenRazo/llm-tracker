// Loading fallback for /changelog. Mirrors: PageHeader + source-chip row +
// 2 week blocks with 4 event cards each.

import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function ChangelogLoading() {
  return (
    <Container>
      <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border)]/60 pb-6 sm:flex-row sm:items-start sm:gap-5">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </header>

      <div className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24 rounded-md" />
        ))}
      </div>

      <div className="space-y-[var(--space-section)]">
        {Array.from({ length: 2 }).map((_, w) => (
          <section key={w}>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-6 w-64" />
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Container>
  );
}
