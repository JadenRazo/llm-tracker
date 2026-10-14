"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { comparisonHref, comparisonRows, comparisonSelection, differingRows, FRONTIER_MODELS, FRONTIER_REVIEW_LABEL } from "@/lib/frontier-models";
import { getProviderMeta } from "@/lib/provider-meta";

export function ModelComparison({ asOf }: { asOf: string }) {
  const params = useSearchParams();
  const models = comparisonSelection(params.get("models"));
  const [differences, setDifferences] = useState(false);
  const rows = comparisonRows(models, asOf);
  const shownRows = differences ? differingRows(rows) : rows;

  function toggle(id: string) {
    const ids = models.map((model) => model.id);
    const next = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
    // Next integrates native history updates with useSearchParams. Push keeps
    // every comparison bookmarkable and restores selection on browser Back.
    window.history.pushState(null, "", comparisonHref(next));
  }

  return (
    <>
      <fieldset className="comparison-picker">
        <legend>Choose two or three models</legend>
        <div>{FRONTIER_MODELS.map((model) => (
          <div key={model.id} className="comparison-model-option" style={{ ["--provider-accent" as string]: getProviderMeta(model.provider).accentVar }}>
            <label><input type="checkbox" checked={models.some((m) => m.id === model.id)} onChange={() => toggle(model.id)} /><span><span className="frontier-lab">{model.lab}</span><strong>{model.name}</strong></span></label>
            <Link className="comparison-profile-link" href={`/models/${model.id}`} aria-label={`Read ${model.name} profile`}>Profile <ArrowUpRight size={14} aria-hidden /></Link>
          </div>
        ))}</div>
      </fieldset>
      <div className="comparison-toolbar"><p role="status">{models.length} of {FRONTIER_MODELS.length} models selected</p><label><input type="checkbox" checked={differences} onChange={(event) => setDifferences(event.target.checked)} />Show differences only</label></div>
      {models.length < 2 ? <div className="comparison-empty"><h2>{models.length === 0 ? "Choose your first two models." : "Add one more model to compare."}</h2><p>Select models above to compare their strengths, limits, and pricing side by side.</p></div> : <>
        <p className="comparison-explainer">Standard API prices in USD per million tokens. Sources checked {FRONTIER_REVIEW_LABEL}; rates follow the published schedule. Conditions appear alongside the rates. Task fit is editorial guidance; specifications are provider-reported.</p>
        <div className="comparison-desktop">
          <table className="comparison-table"><caption className="sr-only">Frontier model comparison{differences ? ", differences only" : ""}</caption><thead><tr><th scope="col">What matters</th>{models.map((model) => <th scope="col" key={model.id}><Link href={`/models/${model.id}`}>{model.name}<ArrowUpRight size={15} aria-hidden /></Link></th>)}</tr></thead><tbody>{shownRows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, i) => <td key={models[i].id}>{value}</td>)}</tr>)}<tr><th scope="row">Official sources</th>{models.map((model) => <td key={model.id} className="comparison-sources">{model.sources.map((source) => <a key={source.url} href={source.url}>{source.label}<ArrowUpRight size={13} aria-hidden /></a>)}</td>)}</tr></tbody></table>
        </div>
        <div className="comparison-mobile">{shownRows.map((row) => <section key={row.label}><h2>{row.label}</h2><dl>{models.map((model, i) => <div key={model.id}><dt>{model.name}</dt><dd>{row.values[i]}</dd></div>)}</dl></section>)}<section><h2>Official sources</h2>{models.map((model) => <div className="comparison-mobile-source" key={model.id}><Link href={`/models/${model.id}`}>{model.name} profile</Link>{model.sources.map((source) => <a href={source.url} key={source.url}>{source.label} ↗</a>)}</div>)}</section></div>
      </>}
    </>
  );
}
