import {
  Boxes,
  Brain,
  ChevronsUpDown,
  Eye,
  FileText,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Model } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";

/** Known capability → icon + human label. Anything not in the map renders as a
 * plain text pill using the raw key (capitalized / spaced). */
const CAPABILITY_META: Record<string, { icon: LucideIcon; label: string }> = {
  toolUse: { icon: Wrench, label: "Tool use" },
  vision: { icon: Eye, label: "Vision" },
  extendedThinking: { icon: Brain, label: "Extended thinking" },
  pdfs: { icon: FileText, label: "PDFs" },
};

interface ResolvedCapability {
  key: string;
  label: string;
  icon?: LucideIcon;
}

function resolveCapabilities(caps: Record<string, boolean> | null): ResolvedCapability[] {
  if (!caps) return [];
  return Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => {
      const known = CAPABILITY_META[key];
      if (known) return { key, label: known.label, icon: known.icon };
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
      return { key, label };
    });
}

function formatContextWindow(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toString();
}

interface HeaderCellProps {
  children: React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  className?: string;
}

function HeaderCell({ children, sortable = false, align = "left", className }: HeaderCellProps) {
  return (
    <th
      className={`px-4 py-3 text-meta text-[var(--color-text-muted)] ${
        align === "right" ? "text-right" : "text-left"
      } ${className ?? ""}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {children}
        {sortable ? (
          <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
        ) : null}
      </span>
    </th>
  );
}

export function ModelTable({ models }: { models: Model[] }) {
  if (models.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="Catalog warming up"
        description="The models poller runs every 30 minutes."
        hint="First population typically completes within 30 minutes of deploy."
      />
    );
  }

  return (
    <>
      <ul className="space-y-3 lg:hidden">
        {models.map((m) => {
          const caps = resolveCapabilities(m.capabilities);
          return (
            <li key={m.id}>
              <Card variant="raised" className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <code className="break-all font-mono text-ui-sm text-[var(--color-text-primary)]">
                      {m.id}
                    </code>
                  </div>
                  {m.contextWindow ? (
                    <span className="inline-flex shrink-0 items-center rounded border border-[var(--color-border)]/50 bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-ui-sm text-[var(--color-text-secondary)]">
                      {formatContextWindow(m.contextWindow)}
                    </span>
                  ) : null}
                </div>

                <p className="text-ui-md text-[var(--color-text-primary)]">
                  {m.displayName}
                </p>

                {caps.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {caps.map((c) => (
                      <Badge
                        key={c.key}
                        variant="source"
                        sourceKey="anthropic_models"
                        icon={c.icon}
                      >
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-center gap-2 text-meta text-[var(--color-text-muted)]">
                  <span>First seen</span>
                  <RelativeTime date={m.firstSeenAt} className="text-meta" />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card variant="raised" className="hidden overflow-hidden p-0 lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border)] text-ui-sm">
            <thead className="bg-[var(--color-surface-raised)]">
              <tr>
                <HeaderCell sortable className="sticky left-0 z-10 bg-[var(--color-surface-raised)]">
                  ID
                </HeaderCell>
                <HeaderCell sortable>Display name</HeaderCell>
                <HeaderCell sortable align="right">
                  Context
                </HeaderCell>
                <HeaderCell>Capabilities</HeaderCell>
                <HeaderCell sortable>First seen</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {models.map((m) => {
                const caps = resolveCapabilities(m.capabilities);
                return (
                  <tr
                    key={m.id}
                    className="transition-colors hover:bg-[color-mix(in_oklab,var(--color-src-models)_6%,var(--color-surface))]"
                  >
                    <td className="sticky left-0 bg-[var(--color-surface)] px-4 py-3 font-mono text-ui-sm text-[var(--color-text-primary)]">
                      {m.id}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{m.displayName}</td>
                    <td className="px-4 py-3 text-right">
                      {m.contextWindow ? (
                        <span className="inline-flex items-center rounded border border-[var(--color-border)]/50 bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-ui-sm text-[var(--color-text-secondary)]">
                          {formatContextWindow(m.contextWindow)}
                        </span>
                      ) : (
                        <span className="font-mono text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {caps.length === 0 ? (
                          <span className="text-meta text-[var(--color-text-muted)]">—</span>
                        ) : (
                          caps.map((c) => (
                            <Badge
                              key={c.key}
                              variant="source"
                              sourceKey="anthropic_models"
                              icon={c.icon}
                            >
                              {c.label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime date={m.firstSeenAt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
