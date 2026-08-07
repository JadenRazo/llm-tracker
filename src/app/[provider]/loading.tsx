// Loading fallback for the `/[provider]/...` subtree. Mirrors the provider
// home's vertical rhythm (hero → card grid) so the hand-off is visually quiet.

import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function ProviderLoading() {
  return (
    <Container>
      <div className="space-y-[var(--space-section)]">
        <section className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-8 lg:p-12">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-10 w-3/4" />
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
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
