import { ATTRIBUTION, BENCHMARKS, EXCLUDED_BENCHMARKS } from "@/lib/benchmarks/registry";

/** Why these benchmarks, what was left out, and how to read the numbers. */
export function BenchmarkMethod() {
  return (
    <section className="benchmark-method" id="method" aria-labelledby="method-heading">
      <h2 id="method-heading">How these benchmarks were chosen</h2>
      <p>The default set is deliberately small. A benchmark is included when it measures something a reader can name, documents its method, covers current models from all three labs, still separates them, and publishes its results as data the tracker can refresh every two hours.</p>
      <ul>{BENCHMARKS.filter((b) => b.default).map((b) => <li key={b.key}><strong>{b.name}</strong> ({b.capability.toLowerCase()}). {b.rationale}</li>)}</ul>
      <h3>Reading a score</h3>
      <ul>
        <li><strong>One score per model.</strong> Where a model has been run at several reasoning-effort settings, the highest independent result in the benchmark’s standard harness is shown with its setting, and the others are listed beneath it.</li>
        <li><strong>A leader is named only when the data supports it.</strong> Every selected model needs an independent result on the same benchmark and harness, and the published 95% intervals must not overlap. Benchmarks that publish no interval never name a leader.</li>
        <li><strong>Lab-reported scores are labelled and never ranked.</strong> The lab chose the settings and what to publish, so its number is shown next to the independent one, not in place of it.</li>
        <li><strong>A missing result is not a low score.</strong> “No published result” means nobody has published one for that model yet.</li>
      </ul>
      <h3>Considered and left out</h3>
      <ul>{EXCLUDED_BENCHMARKS.map((b) => <li key={b.name}><strong>{b.name}.</strong> {b.reason}</li>)}</ul>
      <p className="benchmark-attribution">Data: <a href={ATTRIBUTION.epoch.url}>{ATTRIBUTION.epoch.text}</a>; <a href={ATTRIBUTION.arcprize.url}>{ATTRIBUTION.arcprize.text}</a>. Scores belong to their publishers; follow each source link to check a number.</p>
    </section>
  );
}
