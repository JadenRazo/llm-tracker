"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { filterActivity, type ActivityItem } from "@/lib/activity";
import { PROVIDERS } from "@/lib/providers";
import { getProviderMeta } from "@/lib/provider-meta";

const CATEGORIES = {
  changes: "Product updates",
  all: "All activity",
  releases: "Releases",
  news: "News",
  docs: "Docs & models",
  status: "Status",
};
const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const [provider, setProvider] = useState("all");
  const [category, setCategory] = useState("changes");
  const [query, setQuery] = useState("");
  const [prereleases, setPrereleases] = useState(false);
  const [visibleCount, setVisibleCount] = useState(8);
  const filtered = useMemo(
    () => filterActivity(items, provider, category, query, prereleases),
    [items, provider, category, query, prereleases],
  );
  const reset = () => {
    setProvider("all");
    setCategory("changes");
    setQuery("");
    setPrereleases(false);
    setVisibleCount(8);
  };
  return (
    <div>
      <div
        className="feed-provider-tabs"
        role="group"
        aria-label="Filter updates by provider"
      >
        {["all", ...PROVIDERS].map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === provider}
            onClick={() => setProvider(p)}
          >
            {p === "all"
              ? "All providers"
              : getProviderMeta(p as (typeof PROVIDERS)[number]).label}
          </button>
        ))}
      </div>
      <div className="feed-tools">
        <div className="search-field">
          <Search size={17} aria-hidden />
          <input
            aria-label="Search recent updates"
            placeholder="Search recent updates…"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear update search"
              onClick={() => setQuery("")}
            >
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        <select
          className="filter-select"
          aria-label="Update type"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {Object.entries(CATEGORIES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="feed-result-bar">
        <p role="status" aria-live="polite">
          {filtered.length} recent{" "}
          {filtered.length === 1 ? "update" : "updates"}
        </p>
        <label>
          <input
            type="checkbox"
            checked={prereleases}
            onChange={(event) => setPrereleases(event.target.checked)}
          />
          Include prereleases
        </label>
      </div>
      {filtered.length ? (
        <ol className="activity-list">
          {filtered.slice(0, visibleCount).map((item) => {
            const meta = getProviderMeta(item.provider);
            const href = item.sources.find((s) => s.url)?.url;
            return (
              <li
                key={item.id}
                className="activity-item"
                style={{ ["--provider-accent" as string]: meta.accentVar }}
              >
                <article>
                  <div className="activity-meta">
                    <span className="activity-provider">
                      <span className="provider-dot" aria-hidden />
                      {meta.label}
                    </span>
                    <span>{CATEGORIES[item.category]}</span>
                    {item.prerelease ? (
                      <span className="preview-label">Prerelease</span>
                    ) : null}
                    <time
                      dateTime={item.timestamp}
                      title={`${item.published ? "Published" : "Detected"} ${item.timestamp}`}
                    >
                      {!item.published ? "Detected " : ""}
                      {DATE.format(new Date(item.timestamp))}
                    </time>
                  </div>
                  <h3>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {item.title}
                        <ArrowUpRight size={17} aria-hidden />
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>
                  {item.summary ? (
                    <p className="activity-summary">{item.summary}</p>
                  ) : null}
                  <div className="activity-sources">
                    {item.sources.map((source, i) =>
                      source.url ? (
                        <a
                          key={`${source.label}-${i}`}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.label}
                          <ArrowUpRight size={12} aria-hidden />
                        </a>
                      ) : (
                        <span key={`${source.label}-${i}`}>{source.label}</span>
                      ),
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="filter-empty">
          <h3>No matching recent updates</h3>
          <p>
            Try another search or include prereleases. These filters search the
            loaded recent updates.
          </p>
          <button type="button" className="action-link" onClick={reset}>
            Reset filters
          </button>
        </div>
      )}
      {filtered.length > visibleCount ? (
        <button
          type="button"
          className="load-more"
          onClick={() => setVisibleCount((count) => count + 8)}
        >
          Show more updates <span>{filtered.length - visibleCount} more</span>
        </button>
      ) : null}
      <p className="feed-footnote">
        A recent selection from each provider, newest first. Related CLI
        releases are grouped. Open a provider’s changelog for more history.
      </p>
    </div>
  );
}
