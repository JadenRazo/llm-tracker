"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import type { Model } from "@/lib/db/schema";
import {
  capabilityLabel,
  capabilityOptions,
  formatContext,
  formatTrackedDate,
  selectModels,
  trueCapabilities,
  type ModelSort,
} from "@/lib/model-catalog";

function ModelIdentity({ model }: { model: Model }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(model.id);
      if (!mounted.current) return;
      setCopyState("copied");
    } catch {
      if (mounted.current) setCopyState("failed");
    }
    if (!mounted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 4000);
  }
  return (
    <div className="min-w-0">
      <p className="font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
        {model.displayName || model.id}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="model-id min-w-0 flex-1 whitespace-normal break-all">
          {model.id}
        </code>
        <button
          type="button"
          className="copy-model-id"
          aria-label={`Copy model ID ${model.id}`}
          onClick={copyId}
        >
          {copyState === "copied" ? (
            <Check size={15} aria-hidden />
          ) : (
            <Copy size={15} aria-hidden />
          )}
        </button>
      </div>
      <span
        role="status"
        className={
          copyState === "idle"
            ? "sr-only"
            : "text-xs text-[var(--color-text-muted)]"
        }
      >
        {copyState === "copied"
          ? "Model ID copied"
          : copyState === "failed"
            ? "Couldn’t copy. Select the model ID to copy it manually."
            : ""}
      </span>
    </div>
  );
}

function Capabilities({ model }: { model: Model }) {
  const keys = trueCapabilities(model.capabilities);
  if (!keys.length) {
    return (
      <span className="text-sm text-[var(--color-text-muted)]">
        None reported
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {keys.map((key) => (
        <span
          key={key}
          className="capability-tag max-w-full whitespace-normal text-xs [overflow-wrap:anywhere]"
        >
          {capabilityLabel(key)}
        </span>
      ))}
    </div>
  );
}

function TrackedDate({ date }: { date: Date }) {
  const formatted = formatTrackedDate(date);
  return formatted ? (
    <time dateTime={date.toISOString()}>{formatted} UTC</time>
  ) : (
    <span>Not reported</span>
  );
}

export function ModelTable({ models }: { models: readonly Model[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState<string | null>(null);
  const [sort, setSort] = useState<ModelSort>("newest");
  const options = useMemo(() => capabilityOptions(models), [models]);
  const activeCapability =
    capability !== null && options.includes(capability) ? capability : null;
  const visible = useMemo(
    () => selectModels(models, query, activeCapability, sort),
    [models, query, activeCapability, sort],
  );
  const changed =
    query !== "" || activeCapability !== null || sort !== "newest";

  function reset() {
    setQuery("");
    setCapability(null);
    setSort("newest");
  }

  return (
    <section aria-label="Model catalog" className="min-w-0 space-y-4">
      <div className="model-toolbar flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={`${id}-search`} className="mb-1 block text-sm">
            Search models
          </label>
          <div className="search-field">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ID, name, or capability"
              className="min-w-0 w-full"
            />
          </div>
        </div>
        <div className="min-w-0 max-w-full">
          <label htmlFor={`${id}-capability`} className="mb-1 block text-sm">
            Capability
          </label>
          <select
            id={`${id}-capability`}
            className="filter-select max-w-full"
            value={activeCapability === null ? "" : `cap:${activeCapability}`}
            onChange={(event) =>
              setCapability(
                event.target.value === "" ? null : event.target.value.slice(4),
              )
            }
          >
            <option value="">All capabilities</option>
            {options.map((key) => (
              <option key={key} value={`cap:${key}`}>
                {capabilityLabel(key)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 max-w-full">
          <label htmlFor={`${id}-sort`} className="mb-1 block text-sm">
            Sort by
          </label>
          <select
            id={`${id}-sort`}
            className="filter-select max-w-full"
            value={sort}
            onChange={(event) => setSort(event.target.value as ModelSort)}
          >
            <option value="newest">Newest tracked</option>
            <option value="name">Name A–Z</option>
            <option value="context">Largest context</option>
          </select>
        </div>
        <button
          type="button"
          className="action-link"
          disabled={!changed}
          onClick={reset}
        >
          Reset
        </button>
      </div>

      <div className="model-results space-y-1 text-sm text-[var(--color-text-secondary)]">
        <p role="status" aria-live="polite" aria-atomic="true">
          Showing {visible.length} of {models.length} models
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="filter-empty space-y-2">
          <p className="font-medium">
            {models.length === 0
              ? "No models tracked yet"
              : "No models match your filters"}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {models.length === 0
              ? "The catalog has no model records to display."
              : "Try a different search or reset the filters."}
          </p>
        </div>
      ) : (
        <>
          <ul
            className="model-mobile-list space-y-3 lg:hidden"
            aria-label="Models"
          >
            {visible.map((model) => (
              <li
                key={model.id}
                className="model-mobile-card min-w-0 space-y-3"
              >
                <ModelIdentity model={model} />
                <p className="text-sm">
                  Context: {formatContext(model.contextWindow)}
                </p>
                <Capabilities model={model} />
                <p className="text-xs text-[var(--color-text-muted)]">
                  First tracked: <TrackedDate date={model.firstSeenAt} />
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <div className="model-table-wrap overflow-x-auto">
              <table className="model-table w-full text-left text-sm">
                <caption className="sr-only">Filtered model catalog</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[32%] px-4 py-3">
                      Model
                    </th>
                    <th scope="col" className="w-[20%] px-4 py-3">
                      Context
                    </th>
                    <th scope="col" className="w-[30%] px-4 py-3">
                      Capabilities
                    </th>
                    <th scope="col" className="w-[18%] px-4 py-3">
                      First tracked
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((model) => (
                    <tr key={model.id}>
                      <td className="px-4 py-3 align-top">
                        <ModelIdentity model={model} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        {formatContext(model.contextWindow)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Capabilities model={model} />
                      </td>
                      <td className="px-4 py-3 align-top text-[var(--color-text-muted)]">
                        <TrackedDate date={model.firstSeenAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
