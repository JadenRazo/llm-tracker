"use client";

import { ArrowUpRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { CliReference } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { useDocOverlay } from "@/components/ui/use-anchored-popover";

interface DocPopoverProps {
  item: CliReference;
  /** Tag the trigger "New" — driven by the caller's freshness threshold. */
  fresh?: boolean;
  /**
   * Custom trigger content. Defaults to the chip used by the command grid.
   * MDX token interception passes the original inline text instead.
   */
  children?: ReactNode;
  /** Visual variant of the default trigger. */
  variant?: "chip" | "inline";
}

const KIND_LABEL: Record<string, string> = {
  slash: "command",
  flag: "flag",
  "cli-subcommand": "subcommand",
  "hook-event": "hook event",
  skill: "skill",
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAliases(metadata: CliReference["metadata"]): string[] {
  const raw = (metadata as Record<string, unknown> | null)?.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string" && a.length > 0);
}

/** The shared body — identical content for the anchored panel and the sheet. */
function PopoverBody({ item, fresh }: { item: CliReference; fresh: boolean }) {
  const deprecated = Boolean(item.deprecatedAt);
  const kindLabel = KIND_LABEL[item.kind] ?? item.kind;
  const aliases = getAliases(item.metadata);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-ui-md font-semibold text-[var(--color-text-primary)] break-all">
          {item.name}
        </span>
        <Badge variant="outline">{kindLabel}</Badge>
        {fresh ? (
          <Badge variant="status" tone="fresh">
            New
          </Badge>
        ) : null}
        {deprecated ? (
          <Badge variant="status" tone="stale">
            Deprecated
          </Badge>
        ) : null}
      </div>

      {item.description ? (
        <p className="mt-2 text-ui-sm leading-snug text-[var(--color-text-secondary)]">
          {item.description}
        </p>
      ) : (
        <p className="mt-2 text-ui-sm italic text-[var(--color-text-muted)]">
          No description in upstream docs yet.
        </p>
      )}

      {item.usage ? (
        <div className="mt-3">
          <span className="text-meta uppercase tracking-wide text-[var(--color-text-muted)]">
            Syntax
          </span>
          <pre className="mt-1 overflow-x-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-surface)] p-2 font-mono text-ui-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
            {item.usage}
          </pre>
        </div>
      ) : null}

      {aliases.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-meta uppercase tracking-wide text-[var(--color-text-muted)]">
            Aliases
          </span>
          {aliases.map((alias) => (
            <code
              key={alias}
              className="rounded-sm border border-[var(--color-border)]/60 bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-meta text-[var(--color-text-secondary)]"
            >
              {alias}
            </code>
          ))}
        </div>
      ) : null}

      {deprecated && item.deprecatedAt ? (
        <p className="mt-3 text-meta text-[var(--color-text-muted)]">
          No longer listed in the Claude Code docs. Last seen around{" "}
          {formatDate(item.deprecatedAt)}.
        </p>
      ) : null}

      {item.docsUrl ? (
        <a
          href={item.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-ui-sm font-medium text-[var(--color-highlight)] transition-colors hover:border-[var(--color-ring)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          Read full docs
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </>
  );
}

/**
 * Reusable doc info card. The trigger opens a portal-rendered popover with
 * the full description, syntax, aliases, deprecation status, and a prominent
 * "Read full docs" CTA — so the explanation is on-page first and the user
 * only navigates away if they want to.
 *
 * Responsive: anchored tooltip at >=640px (hover + click + focus), focus-
 * trapped bottom-sheet dialog below that (tap to open, backdrop/ESC close).
 */
export function DocPopover({
  item,
  fresh = false,
  children,
  variant = "chip",
}: DocPopoverProps) {
  const {
    open,
    setOpen,
    mounted,
    isSheet,
    position,
    triggerProps,
    panelProps,
    sheetProps,
  } = useDocOverlay();
  const deprecated = Boolean(item.deprecatedAt);

  const anchoredPanel =
    mounted && open && !isSheet
      ? createPortal(
          <div
            {...panelProps}
            className={clsx(
              "fixed z-50 w-[min(22rem,calc(100vw-16px))] max-h-[min(24rem,calc(100dvh-32px))] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3.5 pr-9 shadow-[var(--shadow-pop)] transition-[opacity,transform] duration-150 ease-[var(--ease-pop)] motion-reduce:duration-0",
              position
                ? "scale-100 opacity-100"
                : "scale-[0.96] opacity-0",
            )}
            style={{ ...panelProps.style, position: "fixed" }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <X className="size-4" aria-hidden />
            </button>
            <PopoverBody item={item} fresh={fresh} />
          </div>,
          document.body,
        )
      : null;

  const sheet =
    mounted && open && isSheet
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center"
            // No dimming scrim — the page stays visible behind the sheet.
            // Tapping the (transparent) area outside the sheet still closes it.
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              {...sheetProps}
              aria-describedby={`${sheetProps.id}-body`}
              className="relative z-10 w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-modal)] transition-transform duration-200 ease-[var(--ease-pop)] translate-y-0 motion-reduce:duration-0"
            >
              <div
                aria-hidden
                className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-border)]"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <X className="size-4" aria-hidden />
              </button>
              <div id={`${sheetProps.id}-body`}>
                <PopoverBody item={item} fresh={fresh} />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const defaultTrigger =
    variant === "inline" ? (
      <button
        {...triggerProps}
        className={clsx(
          "cursor-pointer rounded-sm border-b border-dashed border-[var(--color-ring)]/50 bg-[var(--color-surface-raised)] px-1 py-0.5 font-mono text-[0.95em] transition-colors hover:border-[var(--color-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          deprecated
            ? "text-[var(--color-text-muted)] line-through decoration-[var(--color-text-muted)]/60"
            : "text-[var(--color-highlight)]",
        )}
      >
        {children ?? item.name}
        {item.description ? (
          <span className="sr-only"> — {item.description}</span>
        ) : null}
      </button>
    ) : (
      <button
        {...triggerProps}
        className={clsx(
          "inline-flex max-w-[min(16rem,calc(100vw-32px))] cursor-pointer items-center gap-2 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-ui-sm transition-colors hover:border-[var(--color-ring)]/50 focus-visible:border-[var(--color-src-gh-cc)] focus-visible:text-[var(--color-src-gh-cc)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          deprecated
            ? "text-[var(--color-text-muted)] line-through decoration-[var(--color-text-muted)]/60"
            : "text-[var(--color-text-primary)]",
        )}
      >
        <span className="truncate">{children ?? item.name}</span>
        {fresh ? (
          <Badge variant="status" tone="fresh">
            New
          </Badge>
        ) : null}
        {item.description ? (
          <span className="sr-only"> — {item.description}</span>
        ) : null}
      </button>
    );

  return (
    <span className="relative inline-block">
      {defaultTrigger}
      {anchoredPanel}
      {sheet}
    </span>
  );
}
