import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { getSource } from "@/components/sources";

type BadgeVariant = "neutral" | "source" | "status" | "outline";
type StatusTone = "operational" | "degraded" | "outage" | "maintenance" | "unknown" | "fresh" | "stale";

interface BadgeProps {
  variant?: BadgeVariant;
  sourceKey?: string;
  tone?: StatusTone;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

const STATUS_TONE_VAR: Record<StatusTone, string> = {
  operational: "var(--color-leaf)",
  degraded: "var(--color-adobe)",
  outage: "var(--color-terra)",
  maintenance: "var(--color-sage)",
  unknown: "var(--color-text-muted)",
  fresh: "var(--color-leaf)",
  stale: "var(--color-gold)",
};

/**
 * Inline label primitive. `source` tints itself from the source palette via
 * color-mix; `status` uses a tone-mapped color and pulses its dot when the
 * service is not fully operational.
 */
export function Badge({
  variant = "neutral",
  sourceKey,
  tone,
  icon: Icon,
  className,
  children,
}: BadgeProps) {
  const base =
    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta";

  if (variant === "source") {
    const tintClass = sourceKey ? getSource(sourceKey).tintClass : "src-default";
    return (
      <span
        className={clsx(
          base,
          tintClass,
          // Text is the tint lightened toward cream so every source tint
          // (incl. the near-black src-default border tint) stays legible on
          // the dark surfaces; the raw tint stays on the icon/border/bg accent.
          "border bg-[color-mix(in_oklab,var(--tint)_14%,transparent)] text-[color-mix(in_oklab,var(--tint)_45%,var(--color-cream))] border-[color-mix(in_oklab,var(--tint)_30%,transparent)]",
          className,
        )}
      >
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {children}
      </span>
    );
  }

  if (variant === "status") {
    const toneVar = tone ? STATUS_TONE_VAR[tone] : "var(--color-text-muted)";
    const pulse =
      tone !== undefined &&
      tone !== "operational" &&
      tone !== "unknown" &&
      tone !== "fresh";
    return (
      <span
        className={clsx(
          base,
          "border",
          className,
        )}
        style={{
          backgroundColor: `color-mix(in oklab, ${toneVar} 14%, transparent)`,
          // Lighten the label toward cream for legibility (the green/gold
          // tones fail 4.5:1 as raw text on surface-raised); the solid dot
          // below keeps the full tone as the status signal.
          color: `color-mix(in oklab, ${toneVar} 45%, var(--color-cream))`,
          borderColor: `color-mix(in oklab, ${toneVar} 30%, transparent)`,
        }}
      >
        <span
          className={clsx(
            "size-1.5 rounded-full",
            pulse && "animate-pulse-dot",
          )}
          style={{ backgroundColor: toneVar }}
          aria-hidden
        />
        {children}
      </span>
    );
  }

  if (variant === "outline") {
    return (
      <span
        className={clsx(
          base,
          "border border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]",
          className,
        )}
      >
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {children}
      </span>
    );
  }

  // neutral
  return (
    <span
      className={clsx(
        base,
        "bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]",
        className,
      )}
    >
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {children}
    </span>
  );
}
