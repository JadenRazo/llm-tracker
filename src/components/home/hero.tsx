import { StatusPill } from "@/components/home/status-pill";

interface HeroProps {
  currentStatus: string | null;
}

/**
 * Homepage hero. Full-width rounded panel with the product pitch on the
 * left and the live Anthropic status pill on the right. Static markup —
 * all state is server-rendered from the feed load.
 */
export function Hero({ currentStatus }: HeroProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-5 animate-in sm:p-6 lg:p-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="max-w-2xl space-y-3">
          <span className="text-meta text-[var(--color-text-muted)]">
            Claude ecosystem tracker
          </span>
          <h1 className="text-display-lg text-[var(--color-text-primary)] sm:text-display-xl">
            Claude ecosystem, at a glance
          </h1>
          <p className="text-ui-md text-[var(--color-text-secondary)] sm:text-ui-lg">
            New models the instant they&apos;re live. Claude Code releases. SDKs,
            docs, status — deduped into one feed, with a curated layer of
            power-user tips.
          </p>
        </div>
        <StatusPill status={currentStatus} />
      </div>
    </section>
  );
}
