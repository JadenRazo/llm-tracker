import { FRONTIER_REVIEWED_AT, FRONTIER_REVIEW_LABEL, profileNeedsReview } from "@/lib/frontier-models";

export function FrontierSourceNote({ asOf }: { asOf: string }) {
  const overdue = profileNeedsReview(new Date(`${asOf}T00:00:00Z`));
  return (
    <div className={`frontier-source-note${overdue ? " needs-review" : ""}`}>
      <p><strong>{overdue ? "Profiles due for review" : "Grounded in provider documentation"}</strong> · Checked <time dateTime={FRONTIER_REVIEWED_AT}>{FRONTIER_REVIEW_LABEL}</time></p>
      <p>Curated frontier picks, with editorial guidance on task fit. No cross-lab performance ranking. API limits and prices differ from chat subscriptions.{overdue ? " A newer model or price may be available; check the linked official catalogs." : " Open a profile for sources and tradeoffs."}</p>
    </div>
  );
}
