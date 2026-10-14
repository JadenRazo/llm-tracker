import type { FrontierModel } from "@/lib/frontier-models";
import { verificationLabel } from "@/lib/frontier/presentation";

export function FrontierSourceNote({ models }: { models: readonly FrontierModel[] }) {
  const degraded = models.some((m) => m.freshness !== "current");
  return <div className={`frontier-source-note${degraded ? " needs-review" : ""}`}>
    <p><strong>{degraded ? "Check the verification dates" : "Automatically checked against official sources"}</strong></p>
    {models.map((model) => <p key={model.id} data-model-id={model.id} data-revision={model.revisionId ?? "bundled"} data-freshness={model.freshness}>
      <strong>{model.name}</strong> · <time dateTime={model.verifiedAt}>{verificationLabel(model.verifiedAt)}</time><br />{model.freshnessNote}
    </p>)}
    <p>Task guidance follows documented capabilities. No cross-lab performance ranking. API limits and prices differ from chat subscriptions. Open a profile for the official sources and pricing conditions.</p>
  </div>;
}
