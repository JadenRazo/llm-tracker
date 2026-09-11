"use client";

import { useState } from "react";
import { Search, Terminal, X } from "lucide-react";
import type { CliReference } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui/empty-state";
import { CliReferenceChip } from "@/components/home/cli-reference-chip";

const KIND_LABEL: Record<string, string> = {
  slash: "Slash commands",
  flag: "Flags",
  "cli-subcommand": "CLI subcommands",
  "hook-event": "Hook events",
  skill: "Skills",
};
const KIND_ORDER = ["slash", "flag", "cli-subcommand", "hook-event", "skill"];

export function CommandGrid({ items }: { items: CliReference[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  if (!items.length)
    return (
      <EmptyState
        icon={Terminal}
        title="No commands recorded yet"
        description="The command reference will appear here when source data is available."
      />
    );
  const kinds = [...new Set(items.map((item) => item.kind))].sort(
    (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
  );
  const needle = query.trim().toLocaleLowerCase();
  const filtered = items.filter(
    (item) =>
      (kind === "all" || kind === item.kind) &&
      `${item.name} ${item.description ?? ""} ${item.usage ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  return (
    <div>
      <div className="feed-tools mb-3">
        <div className="search-field">
          <Search size={17} aria-hidden />
          <input
            aria-label="Search commands"
            type="search"
            placeholder="Search commands, flags, or what you want to do…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear command search"
              onClick={() => setQuery("")}
            >
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        <select
          className="filter-select"
          aria-label="Command type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="all">All commands</option>
          {kinds.map((key) => (
            <option key={key} value={key}>
              {KIND_LABEL[key] ?? key}
            </option>
          ))}
        </select>
      </div>
      <p
        className="mb-5 text-ui-sm text-[var(--color-text-muted)]"
        role="status"
        aria-live="polite"
      >
        {filtered.length} of {items.length} commands
      </p>
      {filtered.length ? (
        <div className="command-groups">
          {kinds.map((key) => {
            const rows = filtered.filter((item) => item.kind === key);
            return rows.length ? (
              <section key={key}>
                <h3 className="mb-3 font-sans text-ui-sm font-medium text-[var(--color-text-muted)]">
                  {KIND_LABEL[key] ?? key}{" "}
                  <span className="ml-1">{rows.length}</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {rows.map((item) => (
                    <CliReferenceChip key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ) : null;
          })}
        </div>
      ) : (
        <div className="filter-empty">
          <h3>No matching commands</h3>
          <p>Try a different search or command type.</p>
          <button
            className="action-link"
            type="button"
            onClick={() => {
              setQuery("");
              setKind("all");
            }}
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
