import { CloudOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shown when a read FAILED — never when a table is legitimately empty. Saying
 * "nothing has been ingested" during a database outage is a lie, and it is the
 * lie that made a broken deploy look like a new site.
 */
export function DataUnavailable({ what }: { what: string }) {
  return (
    <EmptyState
      icon={CloudOff}
      title={`${what} is temporarily unavailable`}
      description="We couldn’t load this data. Please reload in a moment, or use the provider links to reach the original sources."
      hint="Previously recorded data may still exist."
    />
  );
}
