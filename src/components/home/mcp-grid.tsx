import { Star } from "lucide-react";
import { clsx } from "clsx";
import type { McpServer } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface McpGridProps {
  servers: McpServer[];
}

function formatStars(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toString();
}

/**
 * Top-N MCP server list for the homepage. Server component — receives pre-ranked
 * rows; renders them with install command, star count, and official/community pill.
 * Shows a calm empty state if the poller hasn't run yet.
 */
export function McpGrid({ servers }: McpGridProps) {
  if (servers.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="Poller warming up"
        description="The MCP-servers scraper runs every 2 hours. First population happens ~40 seconds after deploy."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {servers.map((s, i) => {
        const stars = formatStars(s.stars);
        // Feature the first card — spans 2/3 of the row on lg, creating
        // asymmetry that reinforces "this is the short list worth your budget."
        const featured = i === 0;
        return (
          <Card
            key={s.id}
            variant="raised"
            className={clsx(
              "flex h-full flex-col gap-3",
              featured && "lg:col-span-2",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <a
                href={s.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={clsx(
                  "font-display text-display-sm text-[var(--color-text-primary)] hover:text-[var(--color-highlight)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm",
                  featured && "text-display-md",
                )}
              >
                {s.name}
              </a>
              <Badge variant="outline">{s.official ? "Official" : "Community"}</Badge>
            </div>
            {s.description ? (
              <p className="text-ui-md text-[var(--color-text-secondary)]">{s.description}</p>
            ) : null}
            {s.installCmd ? (
              <pre className="mt-auto overflow-x-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-ui-sm text-[var(--color-text-primary)]">
                <code>{s.installCmd}</code>
              </pre>
            ) : null}
            <div className="flex items-center gap-3 text-meta text-[var(--color-text-muted)]">
              {stars ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3" aria-hidden />
                  {stars}
                </span>
              ) : null}
              {s.category ? <span>{s.category}</span> : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
