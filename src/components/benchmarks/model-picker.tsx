"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { getProviderStyle } from "@/lib/provider-meta";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { MAX_COMPARED, compareHref } from "@/lib/benchmarks/selection";

export interface PickerOption {
  id: string;
  name: string;
  provider: Provider;
  lab: string;
  /** How many of the default benchmarks have an independent result for it. */
  coverage: number;
  /** The tracker's verified pick for its lab. */
  pick: boolean;
}

/**
 * Choose up to four tracked models from any lab. Each change navigates to the
 * URL for that selection, so the comparison is rendered on the server and the
 * address can be shared as it is.
 */
export function ModelPicker({ options, selected, defaultCount }: { options: readonly PickerOption[]; selected: readonly string[]; defaultCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const chosen = selected.map((id) => options.find((o) => o.id === id)).filter((o): o is PickerOption => !!o);
  const full = chosen.length >= MAX_COMPARED;
  const go = (ids: string[]) => startTransition(() => router.push(compareHref(ids), { scroll: false }));

  const groups = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = options.filter((o) => !selected.includes(o.id) && terms.every((t) => `${o.name} ${o.id} ${o.lab}`.toLowerCase().includes(t)));
    // Models with results first: they are the ones a comparison can say something about.
    matches.sort((a, b) => Number(b.pick) - Number(a.pick) || b.coverage - a.coverage);
    return PROVIDERS.map((provider) => ({ provider, lab: options.find((o) => o.provider === provider)?.lab ?? provider, models: matches.filter((o) => o.provider === provider) })).filter((g) => g.models.length);
  }, [options, query, selected]);
  const shown = groups.reduce((n, g) => n + g.models.length, 0);

  return (
    <section className="benchmark-picker" aria-labelledby="picker-heading" aria-busy={pending}>
      <h2 id="picker-heading">Models to compare</h2>
      {chosen.length === 0 ? <p className="benchmark-picker-empty">No models selected. Add one below.</p> : (
        <ul className="benchmark-chips" aria-label="Selected models">
          {chosen.map((model) => (
            <li key={model.id} style={getProviderStyle(model.provider)}>
              <span><span className="frontier-lab"><span className="provider-dot" aria-hidden />{model.lab}</span><strong>{model.name}</strong></span>
              <button type="button" onClick={() => go(selected.filter((id) => id !== model.id))} aria-label={`Remove ${model.name}`}><X size={16} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="benchmark-picker-status" role="status" aria-live="polite">
        {pending ? "Updating the comparison…" : `${chosen.length} of ${MAX_COMPARED} selected${full ? ". Remove one to add another." : ""}`}
      </p>
      <details className="benchmark-add" open={chosen.length < 2 || undefined}>
        <summary><Plus size={16} aria-hidden />Add a model <span>({options.length} tracked across {PROVIDERS.length} labs)</span></summary>
        <div className="search-field">
          <Search className="size-4 shrink-0" aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID or lab" aria-label="Filter models" className="min-w-0 w-full" />
        </div>
        <p className="sr-only" role="status" aria-live="polite">{shown} models match</p>
        {shown === 0 ? <p className="benchmark-picker-empty">No tracked model matches “{query}”.</p> : (
          <div className="benchmark-options">
            {groups.map((group) => (
              <fieldset key={group.provider} style={getProviderStyle(group.provider)} disabled={full || pending}>
                <legend className="frontier-lab"><span className="provider-dot" aria-hidden />{group.lab}</legend>
                <ul>
                  {group.models.map((model) => (
                    <li key={model.id}>
                      <button type="button" onClick={() => { setQuery(""); go([...selected, model.id]); }}>
                        <span><strong>{model.name}</strong><code>{model.id}</code></span>
                        <small>{model.pick ? "Current pick · " : ""}{model.coverage ? `${model.coverage} of ${defaultCount} benchmarks` : "No results yet"}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
