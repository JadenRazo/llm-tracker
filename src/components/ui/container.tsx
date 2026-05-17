import { clsx } from "clsx";
import type { ReactNode } from "react";

interface ContainerProps {
  size?: "default" | "narrow";
  className?: string;
  children: ReactNode;
}

/**
 * Width-constrained wrapper. `default` (max-w-6xl) matches the global
 * layout shell; `narrow` (max-w-3xl) is used on article/detail pages.
 */
export function Container({ size = "default", className, children }: ContainerProps) {
  return (
    <div
      className={clsx(
        "mx-auto w-full",
        size === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
