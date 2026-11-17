import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Provider } from "@/lib/providers";
import { comparison, effortLabel, formatInterval, formatScore, harnessLabel } from "@/lib/benchmarks/compare";
import { compareHref, launchSiblings } from "@/lib/benchmarks/selection";
import { getTrackedModels } from "@/lib/benchmarks/view";

/** One model's published results, and the comparisons a reader is likely to want next. */
export async function ModelBenchmarks({ model }: { model: { id: string; name: string; provider: Provider } }) {
  const tracked = await getTrackedModels();
  const table = comparison([model], tracked.byModel);
  const rows = [...table.defaults, ...table.more].filter((row) => row.cells[0].primary || row.cells[0].reported.length);
  const entry = tracked.models.find((m) => m.id === model.id);
  const siblings = entry ? launchSiblings(entry, tracked.models, 2) : [];
  const otherLabs = tracked.frontier.current.filter((pick) => pick.provider !== model.provider && pick.id !== model.id);
  const links = [
    ...siblings.map((sibling) => ({ label: <>{model.name}<small>vs</small>{sibling.name}</>, href: compareHref([model.id, sibling.id]), key: sibling.id })),
    ...(otherLabs.length ? [{ label: <>{model.name}<small>vs</small>{otherLabs.map((m) => m.name).join(" and ")}</>, href: compareHref([model.id, ...otherLabs.map((m) => m.id)]), key: "labs" }] : []),
    { label: <>{model.name}<small>vs</small>any tracked model</>, href: compareHref([model.id]), key: "any" },
  ];
  return (
    <>
      <section className="profile-benchmarks" aria-labelledby="benchmarks-heading">
        <h2 id="benchmarks-heading">Published benchmark results</h2>
        {tracked.benchmarks.unavailable ? <p role="status">Benchmark data is temporarily unavailable. This is a problem on our side, not a sign that no results exist.</p>
          : tracked.benchmarks.rows.length === 0 ? <p role="status">Benchmark results have not been collected yet. They appear here after the next two-hourly refresh.</p>
          : rows.length === 0 ? <p>No published result for {model.name} on the benchmarks the tracker follows. New models are often evaluated days or weeks after launch.</p>
            : <dl>{rows.map((row) => {
              const cell = row.cells[0], spec = row.benchmark, primary = cell.primary;
              return (
                <div key={spec.key}>
                  <dt><span className="intro-kicker">{spec.capability}</span>{spec.name} <span>{spec.version}</span></dt>
                  <dd>
                    {primary && <p><strong>{formatScore(primary.score, spec.unit)}</strong> {[spec.metric.toLowerCase(), spec.direction === "higher" ? "higher is better" : "lower is better", effortLabel(primary.effort), harnessLabel(primary.harness), formatInterval(primary, spec.unit)].filter(Boolean).join(" · ")}</p>}
                    {primary?.note && <p>{primary.note}</p>}
                    {primary && <p>Independent, run by {spec.evaluator}. {primary.url && <a href={primary.url}>Source<ArrowUpRight size={13} aria-hidden /></a>}</p>}
                    {cell.reported.map((result, i) => <p key={i}><span className="benchmark-tag">Reported by {result.by}</span> <strong>{formatScore(result.score, spec.unit)}</strong> · {result.settings}. {result.url && <a href={result.url}>{result.label}<ArrowUpRight size={13} aria-hidden /></a>}</p>)}
                    {spec.saturated && <p className="benchmark-caution">{spec.saturated}</p>}
                    {spec.caution && <p className="benchmark-caution"><strong>Known problems.</strong> {spec.caution.text} <a href={spec.caution.url}>Read the review<ArrowUpRight size={13} aria-hidden /></a></p>}
                  </dd>
                </div>
              );
            })}</dl>}
        <p className="profile-editorial">Each number is the model’s best published configuration on that benchmark. <Link href="/compare#method">How these benchmarks were chosen</Link>.</p>
      </section>
      <section className="profile-compare" aria-labelledby="compare-heading">
        <h2 id="compare-heading">Compare on benchmarks</h2>
        <div>{links.map((link) => <Link key={link.key} href={link.href}><span>{link.label}</span><ArrowRight size={20} aria-hidden /></Link>)}</div>
      </section>
    </>
  );
}
