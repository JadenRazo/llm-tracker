import { clsx } from "clsx";
import type { ReactNode } from "react";
import { getSource } from "@/components/sources";

interface CardProps {
  variant?: "flat" | "raised" | "outlined";
  /** Source key supplies a matching tint for interactive states. */
  sourceKey?: string;
  /** Adds hover lift + tinted outline. Intended for cards that link somewhere. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Generic container primitive. Styling is driven by `variant` and `sourceKey`;
 * `interactive` toggles the hover affordance. No client JS.
 */
export function Card({
  variant = "flat",
  sourceKey,
  interactive = false,
  className,
  children,
}: CardProps) {
  const tintClass = sourceKey ? getSource(sourceKey).tintClass : undefined;

  return (
    <div
      className={clsx(
        // Base
        "rounded-xl p-5",
        variant === "outlined"
          ? "border border-[var(--color-border)] bg-transparent"
          : "border border-[var(--color-border)] bg-[var(--color-surface)]",
        tintClass,
        // Interactive affordance
        interactive &&
          "transition-colors duration-150 hover:border-[var(--color-text-muted)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
