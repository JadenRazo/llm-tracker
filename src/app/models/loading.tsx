// Loading fallback for /models. Mirrors the real page: PageHeader + 3 stats +
// a full-width model table skeleton (8 rows × 5 columns).

import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonStat } from "@/components/ui/skeleton";

export default function ModelsLoading() {
  return (
    <Container>
      <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border)]/60 pb-6 sm:flex-row sm:items-start sm:gap-5">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </header>

      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonStat key={i} />
          ))}
        </section>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="hidden border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] sm:grid sm:grid-cols-5 sm:gap-4 sm:px-4 sm:py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: 8 }).map((_, r) => (
              <div key={r} className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-5">
                {Array.from({ length: 5 }).map((_, c) => (
                  <Skeleton key={c} className="h-4" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}
