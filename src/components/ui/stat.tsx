import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type StatTone = "default" | "success" | "warning" | "danger";

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Optional trend indicator — rendered verbatim after the value (e.g. "+3"). */
  trend?: ReactNode;
  className?: string;
}

const TONE_VAR: Record<StatTone, string> = {
  default: "var(--color-border)",
  success: "var(--color-leaf)",
  warning: "var(--color-adobe)",
  danger: "var(--color-terra)",
};

/**
 * Key-metric tile. Replaces the older `StatCard` — same label/value/hint
 * shape with added icon + tone support.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  trend,
  className,
}: StatProps) {
  const toneVar = TONE_VAR[tone];

  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-meta text-[var(--color-text-muted)]">{label}</p>
        <p className="mt-1 flex items-baseline gap-2 text-display-lg font-mono text-[var(--color-text-primary)]">
          <span className="truncate">{value}</span>
          {trend ? (
            <span className="text-ui-sm text-[var(--color-text-secondary)]">{trend}</span>
          ) : null}
        </p>
        {hint ? (
          <p className="mt-1 text-meta text-[var(--color-text-muted)]">{hint}</p>
        ) : null}
      </div>
      {Icon ? (
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `color-mix(in oklab, ${toneVar} 12%, var(--color-surface))`,
            color: toneVar,
          }}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
      ) : null}
    </div>
  );
}
