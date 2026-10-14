# Maintain the frontier profiles

The homepage features one documented frontier model per tracked lab. Edit
`src/lib/frontier-models.ts` to update profiles, sources, pricing conditions and
the review date together. These are curated recommendations, separate from the
automatically ingested provider catalogs. Ingestion time must never refresh the
editorial review date. Profiles remain useful during a database outage; the live
feed still shows its unavailable state.

Before changing a featured model, open its official specifications, pricing and
current model lineup. Record restrictions, preview status, long-context pricing,
shared token limits and scheduled price changes. Preserve provider order. Update
task guidance in `src/components/frontier/task-guide.tsx` when a capability or
price advantage changes. Do not carry an older model's recommendations forward
based on a similar name. Avoid claiming a cross-lab winner without comparable
independent evaluation evidence.

Sources checked **2026-10-14**:

- [Claude lineup](https://platform.claude.com/docs/en/models/overview) and
  [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview).
  Fable is the demanding-work pick; Anthropic recommends Opus 5.5 for most work.
  [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
  covers all active models; [effort controls](https://platform.claude.com/docs/en/build-with-claude/effort)
  include all five levels on Fable 5.1, alongside always-on adaptive thinking.
- [OpenAI lineup](https://developers.openai.com/api/docs/models) and
  [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
  Standard rates rise for requests exceeding 272K input tokens.
  [File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
  include PDF text and page images on vision-capable models such as Astra.
- [Gemini lineup](https://ai.google.dev/gemini-api/docs/models),
  [Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon) and
  [pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon).
  Argon has a shared input/output budget and a separate long-decode mode.
  Introductory prices end November 30; the data includes December rates.

The input row includes modalities and PDF documents consistently across all
three APIs. PDF support is not a Gemini-only distinction; file and page limits
remain provider-specific. Compare like capabilities when selecting facts for
each column, rather than copying differently scoped provider summaries.

After 30 days the UI displays a review-due notice; this does not automatically
refresh content or verify continued availability. No new poller or paid model
calls are introduced. Review this file and the cited pages when a lab announces
a replacement; update the editorial snapshot through the normal release path.

Run `npm run test:ui`, types, lint, build and the prerender guard. Check homepage,
profiles and comparison on phones and desktop, including selection, direct
links, invalid IDs, browser Back and differences-only mode. Static profiles
use request-time rendering for date-sensitive prices and review warnings.
