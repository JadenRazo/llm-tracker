"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface FeedOption {
  id: string;
  label: string;
  url: string;
}

export function FeedSubscription({ feeds }: { feeds: readonly FeedOption[] }) {
  const id = useId();
  const [selected, setSelected] = useState(feeds[0].id);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const request = useRef(0);
  const address = useRef<HTMLTextAreaElement>(null);
  const feed = feeds.find((option) => option.id === selected) ?? feeds[0];

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  function chooseFeed(value: string) {
    request.current += 1;
    setSelected(value);
    setCopyState("idle");
  }

  async function copyFeed() {
    const current = ++request.current;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(feed.url);
      if (current === request.current) setCopyState("copied");
    } catch {
      if (current !== request.current) return;
      setCopyState("failed");
      address.current?.focus();
      address.current?.select();
    }
  }

  return (
    <section className="subscription-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Choose your feed</h2>
      <fieldset className="subscription-choices">
        <legend className="sr-only">Updates to follow</legend>
        {feeds.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name={`${id}-provider`}
              value={option.id}
              checked={selected === option.id}
              onChange={() => chooseFeed(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-url`} className="subscription-url-label">
        {feed.label} feed URL
      </label>
      <textarea
        ref={address}
        id={`${id}-url`}
        className="subscription-url"
        rows={2}
        readOnly
        value={feed.url}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        aria-describedby={`${id}-help`}
      />
      <button
        type="button"
        onClick={copyFeed}
        className="subscription-copy"
        disabled={copyState === "copying"}
      >
        {copyState === "copied" ? (
          <Check size={18} aria-hidden />
        ) : (
          <Copy size={18} aria-hidden />
        )}
        {copyState === "copied"
          ? "Feed link copied"
          : copyState === "copying"
            ? "Copying…"
            : "Copy feed link"}
      </button>
      <p
        id={`${id}-help`}
        className="subscription-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {copyState === "copied"
          ? `Copied the ${feed.label} feed link. Paste it into your feed reader to subscribe.`
          : copyState === "failed"
            ? "Couldn’t copy automatically. Select and copy the URL above, then paste it into your feed reader."
            : "Add this URL to your feed reader to receive new entries."}
      </p>
      <details className="subscription-raw">
        <summary>Looking for the raw feed?</summary>
        <p>
          RSS readers use XML to read updates. Opening it in a browser may show
          raw text.
        </p>
        <a href={feed.url}>View {feed.label} feed as XML</a>
      </details>
    </section>
  );
}
