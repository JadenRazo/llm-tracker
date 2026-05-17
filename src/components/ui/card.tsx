import { clsx } from "clsx";
import type { ReactNode } from "react";
import { getSource } from "@/components/sources";

interface CardProps {
  variant?: "flat" | "raised" | "outlined";
  /** Source key — when set, applies matching src-* tint class and a left accent. */
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
        variant === "raised" && "shadow-[var(--shadow-raised)]",
        // Source-tinted left accent
        tintClass,
        sourceKey && "border-l-4 border-l-[var(--tint)]",
        // Interactive affordance
        interactive &&
          "transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] hover:outline hover:outline-1 hover:outline-[color-mix(in_oklab,var(--tint,var(--color-border))_40%,transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
