import type { Metadata } from "next";
import Link from "next/link";
import { getFrontierData } from "@/lib/frontier/read";
import { verificationLabel } from "@/lib/frontier/presentation";
import { SpecComparison } from "@/components/frontier/model-comparison";
import { FrontierSourceNote } from "@/components/frontier/source-note";
import { ModelPicker } from "@/components/benchmarks/model-picker";
import { BenchmarkComparison } from "@/components/benchmarks/benchmark-comparison";
import { BenchmarkMethod } from "@/components/benchmarks/benchmark-method";
import { loadComparison } from "@/lib/benchmarks/view";
import { compareHref, launchSiblings } from "@/lib/benchmarks/selection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare AI models on benchmarks", description: "Pick any tracked Claude, OpenAI or Gemini models and compare independent benchmark results side by side, with versions, settings and sources.", alternates: { canonical: "/compare" }, openGraph: { title: "Compare AI models on benchmarks", description: "Independent benchmark results for any tracked Claude, OpenAI and Gemini models, with versions, settings and sources.", url: "/compare" } };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ models?: string | string[] }> }) {
  const params = await searchParams;
  // A repeated parameter (?models=a&models=b) is read as one list, not dropped.
  const raw = Array.isArray(params.models) ? params.models.join(",") : params.models;
  const view = await loadComparison(raw);
  const { selected, table, benchmarks, frontier } = view;
  // Verified profiles for the selected models, including an earlier pick named in the URL.
  const profiles = (await getFrontierData(selected.map((m) => m.id).join(","))).available.filter((m) => selected.some((s) => s.id === m.id));
  const asOf = new Date().toISOString().slice(0, 10);
  const names = selected.map((m) => m.name).join(", ");
  const refreshed = benchmarks.sources.map((s) => s.verifiedAt).filter((v): v is string => !!v).sort()[0];
  const degraded = benchmarks.sources.filter((s) => s.status !== "current");
  const presets = [
    { label: "One pick per lab", href: compareHref(frontier.current.map((m) => m.id)) },
    ...frontier.current.flatMap((pick) => {
      const entry = view.models.find((m) => m.id === pick.id);
      return entry ? launchSiblings(entry, view.models, 1).map((sibling) => ({ label: `${pick.name} vs ${sibling.name}`, href: compareHref([pick.id, sibling.id]) })) : [];
    }),
  ];

  return (
    <div className="frontier-page compare-page">
      <Link href="/" className="frontier-back">← All frontier models</Link>
      <header className="frontier-intro">
        <p className="intro-kicker">Independent results, with their sources</p>
        <h1>Compare models.<br /><span>On published benchmarks.</span></h1>
        <p>Choose up to four tracked models from any lab. Your selection stays in the URL, so you can bookmark or share it.</p>
      </header>

      {view.directoryUnavailable && <p role="status" className="frontier-source-note needs-review">The model catalog is temporarily unavailable, so only the current picks can be chosen right now. This is a problem on our side.</p>}
      {view.unresolved.length > 0 && <p role="status" className="frontier-source-note needs-review">{view.directoryUnavailable ? "Could not be looked up" : "Not a tracked model"}: {view.unresolved.join(", ")}.</p>}
      <ModelPicker options={view.options} selected={selected.map((m) => m.id)} defaultCount={view.defaultCount} />
      <p className="benchmark-presets"><span>Quick comparisons:</span>{presets.map((preset) => <Link key={preset.href} href={preset.href}>{preset.label}</Link>)}</p>

      <section className="benchmark-section" aria-labelledby="benchmarks-heading">
        <h2 id="benchmarks-heading">Benchmarks</h2>
        {benchmarks.unavailable ? (
          <div className="comparison-empty" role="status"><h3>Benchmark data is temporarily unavailable.</h3><p>The tracker could not read its benchmark results just now. This is a problem on our side, not a sign that no results exist. Please try again shortly.</p></div>
        ) : benchmarks.rows.length === 0 ? (
          <div className="comparison-empty" role="status"><h3>Benchmark results have not been collected yet.</h3><p>The first refresh has not completed. Results appear here after the next two-hourly run.</p></div>
        ) : selected.length === 0 ? (
          <div className="comparison-empty"><h3>Choose your first model.</h3><p>Add models above to see their published benchmark results side by side.</p></div>
        ) : (
          <>
            <p className="comparison-explainer">{selected.length === 1 ? `Published results for ${names}. Add another model to compare.` : `Published results for ${names}.`} Each score shows the benchmark version, the metric, who ran it and the settings used. A leader is named only when the results are like for like (same harness, same recorded effort) and their confidence intervals do not overlap. {refreshed && <>Sources last checked <time dateTime={refreshed}>{verificationLabel(refreshed)}</time>.</>}</p>
            {degraded.length > 0 && <p role="status" className="frontier-source-note needs-review">Some results may be out of date: the latest refresh of {degraded.map((s) => (s.source === "benchmarks_epoch" ? "Epoch AI’s data" : "ARC Prize’s data")).join(" and ")} did not complete. Showing the last accepted results.</p>}
            <BenchmarkComparison models={selected} rows={table.defaults} caption={`Benchmark results for ${names}`} />
            {table.more.length > 0 && (
              <details className="benchmark-more">
                <summary>More results for these models <span>({table.more.length} {table.more.length === 1 ? "benchmark" : "benchmarks"}, including lab-reported scores)</span></summary>
                <p className="comparison-explainer">Not part of the default set: saturated, sparsely covered, or reported only by the lab that built the model. The reason is given with each.</p>
                <BenchmarkComparison models={selected} rows={table.more} caption={`Additional benchmark results for ${names}`} />
              </details>
            )}
          </>
        )}
      </section>

      <BenchmarkMethod />

      <section className="benchmark-section" aria-labelledby="specs-heading">
        <h2 id="specs-heading">Specifications and pricing</h2>
        {profiles.length >= 2 ? <SpecComparison asOf={asOf} models={profiles} /> : <p className="comparison-explainer">The tracker verifies full specifications and prices for one pick per lab. {profiles.length === 1 ? `Of the models selected, only ${profiles[0].name} has a verified profile.` : selected.length ? "None of the selected models is a current pick." : ""} Open a model’s page for what the catalog records about it.</p>}
      </section>

      <FrontierSourceNote models={[...frontier.current, ...profiles.filter((p) => !frontier.current.some((c) => c.id === p.id))]} />
    </div>
  );
}
