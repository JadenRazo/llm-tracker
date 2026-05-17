// Site-wide fallback shown while any top-level route is streaming. Mirrors
// the homepage's vertical rhythm (hero → stats strip → card grid) so the
// hand-off to real content is visually quiet.

import { Container } from "@/components/ui/container";
import {
  Skeleton,
  SkeletonCard,
  SkeletonStat,
} from "@/components/ui/skeleton";

export default function RootLoading() {
  return (
    <Container>
      <div className="space-y-[var(--space-section)]">
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-8 lg:p-12">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-10 w-3/4" />
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonStat key={i} />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </section>
      </div>
    </Container>
  );
}
