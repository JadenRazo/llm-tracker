import type { CliReference } from "@/lib/db/schema";
import { DocPopover } from "@/components/ui/doc-popover";

interface CliReferenceChipProps {
  item: CliReference;
  /** Tag the chip "New" — driven by the parent's freshness threshold. */
  fresh?: boolean;
}

/**
 * Chip rendering a single cli_reference row. Thin wrapper over the shared
 * DocPopover (chip variant) so the command grid and MDX token interception
 * share one popover implementation.
 */
export function CliReferenceChip({ item, fresh = false }: CliReferenceChipProps) {
  return <DocPopover item={item} fresh={fresh} variant="chip" />;
}
