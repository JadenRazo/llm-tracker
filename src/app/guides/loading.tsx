// Loading fallback for /guides. Mirrors the real stacked layout: PageHeader
// + 3 guide card skeletons in a 1-column list.

import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function GuidesLoading() {
  return (
    <Container>
      <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border)]/60 pb-6 sm:flex-row sm:items-start sm:gap-5">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </header>

      <ul className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i}>
            <SkeletonCard />
          </li>
        ))}
      </ul>
    </Container>
  );
}
