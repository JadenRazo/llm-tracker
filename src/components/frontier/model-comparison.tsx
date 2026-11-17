"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { comparisonRows, differingRows, type FrontierModel } from "@/lib/frontier-models";
import { getProviderStyle } from "@/lib/provider-meta";

/**
 * Verified specifications and prices, side by side. Only models with a
 * verified profile have these; the page chooses which models to pass in.
 */
export function SpecComparison({ asOf, models }: { asOf: string; models: FrontierModel[] }) {
  const [differences, setDifferences] = useState(false);
  const rows = comparisonRows(models, asOf);
  const shownRows = differences ? differingRows(rows) : rows;
  return (
    <>
      <div className="comparison-toolbar"><p className="comparison-explainer">Standard API prices in USD per million tokens. Verification dates appear below; rates follow the published schedule. Conditions appear alongside the rates.</p><label><input type="checkbox" checked={differences} onChange={(event) => setDifferences(event.target.checked)} />Show differences only</label></div>
      <div className="comparison-desktop">
          <table className="comparison-table"><caption className="sr-only">Frontier model comparison{differences ? ", differences only" : ""}</caption><thead><tr><th scope="col">What matters</th>{models.map((model) => <th scope="col" key={model.id} style={getProviderStyle(model.provider)}><Link href={`/models/${model.id}`}>{model.name}<ArrowUpRight size={15} aria-hidden /></Link></th>)}</tr></thead><tbody>{shownRows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, i) => <td key={models[i].id}>{value}</td>)}</tr>)}<tr><th scope="row">Official sources</th>{models.map((model) => <td key={model.id} className="comparison-sources" style={getProviderStyle(model.provider)}>{model.sources.map((source) => <a key={source.url} href={source.url}>{source.label}<ArrowUpRight size={13} aria-hidden /></a>)}</td>)}</tr></tbody></table>
        </div>
        <div className="comparison-mobile">{shownRows.map((row) => <section key={row.label}><h3>{row.label}</h3><dl>{models.map((model, i) => <div key={model.id} style={getProviderStyle(model.provider)}><dt className="provider-label"><span className="provider-dot" aria-hidden />{model.name}</dt><dd>{row.values[i]}</dd></div>)}</dl></section>)}<section><h3>Official sources</h3>{models.map((model) => <div className="comparison-mobile-source" key={model.id} style={getProviderStyle(model.provider)}><Link href={`/models/${model.id}`}>{model.name} profile</Link>{model.sources.map((source) => <a href={source.url} key={source.url}>{source.label} ↗</a>)}</div>)}</section></div>
    </>
  );
}
