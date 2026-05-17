import { Badge } from "@/components/ui/badge";

/**
 * Normalises an Anthropic status string to one of the `Badge` status tones.
 * Matches are case-insensitive substring checks against the status title
 * (as produced by the `anthropic_status` poller).
 */
export function statusTone(
  status: string | null,
): "operational" | "degraded" | "outage" | "unknown" {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  if (s.includes("operational") || s === "all systems operational") {
    return "operational";
  }
  if (s.includes("degraded") || s.includes("minor") || s.includes("partial")) {
    return "degraded";
  }
  return "outage";
}

interface StatusPillProps {
  status: string | null;
}

/**
 * Homepage hero status indicator. Delegates visual styling to the `Badge`
 * primitive so the pulsing-dot + tone treatment stays consistent with any
 * other status surface.
 */
export function StatusPill({ status }: StatusPillProps) {
  const tone = statusTone(status);
  const label = status ?? "Status unknown";
  return (
    <Badge variant="status" tone={tone} className="px-3 py-1 text-ui-sm normal-case tracking-normal">
      {label}
    </Badge>
  );
}
