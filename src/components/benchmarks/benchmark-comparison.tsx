import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getProviderStyle } from "@/lib/provider-meta";
import { effortLabel, formatInterval, formatScore, harnessLabel, type BenchmarkCell, type BenchmarkComparisonRow, type ComparedModel, type ModelResult } from "@/lib/benchmarks/compare";
import type { BenchmarkDefinition } from "@/lib/benchmarks/registry";

const conditions = (result: ModelResult) => [effortLabel(result.effort), harnessLabel(result.harness)].filter(Boolean).join(" · ");

/** The definition of a benchmark: what it measures, version, metric, direction, who ran it, where to check. */
function BenchmarkFacts({ spec }: { spec: BenchmarkDefinition }) {
  return (
    <div className="benchmark-facts">
      <p className="intro-kicker">{spec.capability}</p>
      <p className="benchmark-name">{spec.name} <span>{spec.version}</span></p>
      <p>{spec.measures}</p>
      <dl>
        <div><dt>Metric</dt><dd>{spec.metric} · {spec.direction === "higher" ? "higher is better" : "lower is better"}</dd></div>
        <div><dt>Run by</dt><dd>{spec.evaluator}{spec.feed === "reported" ? "" : " (independent)"}</dd></div>
      </dl>
      {spec.uncertainty && <p className="benchmark-uncertainty">{spec.uncertainty}</p>}
      {spec.saturated && <p className="benchmark-caution">{spec.saturated}</p>}
      {spec.caution && <p className="benchmark-caution"><strong>Known problems.</strong> {spec.caution.text} <a href={spec.caution.url}>Read the review<ArrowUpRight size={13} aria-hidden /></a></p>}
      <p className="benchmark-links"><a href={spec.methodologyUrl}>Method<ArrowUpRight size={13} aria-hidden /></a><a href={spec.sourceUrl}>Published results<ArrowUpRight size={13} aria-hidden /></a></p>
    </div>
  );
}

function Result({ result, spec, lead }: { result: ModelResult; spec: BenchmarkDefinition; lead?: boolean }) {
  const interval = formatInterval(result, spec.unit), settings = conditions(result);
  return (
    <div className="benchmark-result">
      <p className="benchmark-score">{formatScore(result.score, spec.unit)}{lead && <span className="benchmark-lead">Leads</span>}</p>
      {interval && <p>{interval}</p>}
      {settings && <p>{settings}</p>}
      {result.note && <p>{result.note}</p>}
      {result.url && <p><a href={result.url}>Source<ArrowUpRight size={13} aria-hidden /></a></p>}
    </div>
  );
}

function Cell({ cell, spec, lead }: { cell: BenchmarkCell; spec: BenchmarkDefinition; lead: boolean }) {
  return (
    <>
      {cell.primary ? <Result result={cell.primary} spec={spec} lead={lead} /> : <p className="benchmark-missing">{cell.reported.length ? "No independent result" : "No published result"}</p>}
      {cell.reported.map((result, i) => (
        <div className="benchmark-reported" key={i}>
          <p><span className="benchmark-tag">Reported by {result.by}</span> <strong>{formatScore(result.score, spec.unit)}</strong></p>
          <p>{result.settings}</p>
          {result.url && <p><a href={result.url}>{result.label}<ArrowUpRight size={13} aria-hidden /></a></p>}
        </div>
      ))}
      {cell.others.length > 0 && (
        <details className="benchmark-others">
          <summary>{cell.others.length} other published {cell.others.length === 1 ? "configuration" : "configurations"}</summary>
          <ul>{cell.others.map((result, i) => <li key={i}><strong>{formatScore(result.score, spec.unit)}</strong> {conditions(result) || "Settings not stated"}{result.note ? ` · ${result.note}` : ""}</li>)}</ul>
        </details>
      )}
    </>
  );
}

/**
 * Benchmarks as rows and models as columns on wide screens; one card per
 * benchmark on narrow ones. Both are rendered and CSS shows one.
 */
export function BenchmarkComparison({ models, rows, caption }: { models: readonly ComparedModel[]; rows: readonly BenchmarkComparisonRow[]; caption: string }) {
  return (
    <>
      <div className="comparison-desktop">
        <table className="comparison-table benchmark-table">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">Benchmark</th>{models.map((model) => <th scope="col" key={model.id} style={getProviderStyle(model.provider)}><Link href={`/models/${model.id}`}>{model.name}<ArrowUpRight size={15} aria-hidden /></Link></th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.benchmark.key}>
                <th scope="row"><BenchmarkFacts spec={row.benchmark} /><p className="benchmark-verdict">{row.verdict}</p></th>
                {row.cells.map((cell, i) => <td key={models[i].id} className={row.leader === i ? "is-leader" : undefined}><Cell cell={cell} spec={row.benchmark} lead={row.leader === i} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="comparison-mobile benchmark-cards">
        {rows.map((row) => (
          <section key={row.benchmark.key} aria-label={row.benchmark.name}>
            <BenchmarkFacts spec={row.benchmark} />
            <dl>{models.map((model, i) => <div key={model.id} style={getProviderStyle(model.provider)} className={row.leader === i ? "is-leader" : undefined}><dt className="provider-label"><span className="provider-dot" aria-hidden />{model.name}</dt><dd><Cell cell={row.cells[i]} spec={row.benchmark} lead={row.leader === i} /></dd></div>)}</dl>
            <p className="benchmark-verdict">{row.verdict}</p>
          </section>
        ))}
      </div>
    </>
  );
}
