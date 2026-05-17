export function Footer() {
  return (
    <footer
      className="border-t border-[var(--color-border)] bg-[var(--color-surface)]/30 py-6 sm:py-8"
      style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-xs text-[var(--color-text-muted)] sm:px-5">
        <div className="flex flex-wrap items-center gap-4 text-meta">
          <a
            href="/api/health"
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-highlight)]"
          >
            API
          </a>
          <span className="text-[var(--color-text-muted)]">RSS · coming soon</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Maintained by{" "}
            <a
              href="https://jadenrazo.dev"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-highlight)]"
            >
              Jaden Razo
            </a>
            {" · "}
            <a
              href="https://raizhost.com"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-highlight)]"
            >
              RaizHost
            </a>
          </p>
          <p>
            Not affiliated with Anthropic. Data sourced from public APIs, npm, GitHub, and
            Anthropic&apos;s docs.
          </p>
        </div>
      </div>
    </footer>
  );
}
