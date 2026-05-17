import { clsx } from "clsx";
import { getSource } from "@/components/sources";

interface SourceIconProps {
  sourceKey: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const CHIP_SIZES = {
  sm: "size-7",
  md: "size-10",
  lg: "size-12",
} as const;

const ICON_SIZES = {
  sm: "size-3.5",
  md: "size-5",
  lg: "size-6",
} as const;

/**
 * Rounded chip with the source's lucide icon. Background is a faint tint of
 * the source color mixed over the base surface; icon inherits the tint
 * color directly.
 */
export function SourceIcon({ sourceKey, size = "md", className }: SourceIconProps) {
  const meta = getSource(sourceKey);
  const Icon = meta.icon;

  return (
    <span
      className={clsx(
        meta.tintClass,
        "inline-flex items-center justify-center rounded-lg",
        CHIP_SIZES[size],
        className,
      )}
      style={{
        backgroundColor: "color-mix(in oklab, var(--tint) 12%, var(--color-surface))",
        color: "var(--tint)",
      }}
      aria-hidden
    >
      <Icon className={ICON_SIZES[size]} />
    </span>
  );
}
