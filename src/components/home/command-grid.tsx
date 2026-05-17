import { Terminal } from "lucide-react";
import type { CliReference } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui/empty-state";
import { CliReferenceChip } from "@/components/home/cli-reference-chip";

interface CommandGridProps {
  items: CliReference[];
}

const KIND_LABEL: Record<string, string> = {
  slash: "Slash commands",
  flag: "Flags",
  "cli-subcommand": "CLI subcommands",
  "hook-event": "Hook events",
  skill: "Skills",
};

const NEW_THRESHOLD_DAYS = 90;

function isNew(row: CliReference): boolean {
  if (!row.firstSeenAt) return false;
  if (row.deprecatedAt) return false;
  const age = Date.now() - row.firstSeenAt.getTime();
  return age < NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Grid of slash commands / flags / subcommands / hook events grouped by kind.
 * Each chip is a popover trigger that explains the token in place; the docs
 * link is offered inside the popover rather than as the chip's primary action.
 */
export function CommandGrid({ items }: CommandGridProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Terminal}
        title="Poller warming up"
        description="The Claude Code reference scraper runs every 30 minutes. First population happens ~20 seconds after deploy."
      />
    );
  }

  const groups = new Map<string, CliReference[]>();
  for (const row of items) {
    const bucket = groups.get(row.kind) ?? [];
    bucket.push(row);
    groups.set(row.kind, bucket);
  }

  const kindOrder = ["slash", "flag", "cli-subcommand", "hook-event", "skill"];
  const orderedKinds = [...groups.keys()].sort(
    (a, b) => (kindOrder.indexOf(a) + 99) - (kindOrder.indexOf(b) + 99),
  );

  return (
    <div className="space-y-8">
      {orderedKinds.map((kind) => {
        const rows = groups.get(kind)!;
        return (
          <section key={kind}>
            <h3 className="mb-3 text-meta text-[var(--color-text-muted)]">
              {KIND_LABEL[kind] ?? kind} · {rows.length}
            </h3>
            <div className="flex flex-wrap gap-2">
              {rows.map((row) => (
                <CliReferenceChip key={row.id} item={row} fresh={isNew(row)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
