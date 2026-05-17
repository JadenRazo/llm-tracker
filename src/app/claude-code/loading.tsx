// Loading fallback for /claude-code. Mirrors the version-ladder layout:
// PageHeader + 5 release groups, each with a left-column version label and
// a right column of stacked body skeletons.

import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClaudeCodeLoading() {
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

      <ol className="space-y-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <li
            key={i}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
              <div className="hidden w-[140px] shrink-0 space-y-2 sm:block">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div className="rounded-md border border-[var(--color-border)]/40 bg-[color-mix(in_oklab,var(--color-surface-raised)_40%,transparent)] p-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-5/6" />
                </div>
                <div className="rounded-md border border-[var(--color-border)]/40 bg-[color-mix(in_oklab,var(--color-surface-raised)_40%,transparent)] p-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Container>
  );
}
