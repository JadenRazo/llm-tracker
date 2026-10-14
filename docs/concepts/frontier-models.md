# Frontier model discovery

Replace the release-first opening with a useful first stop for choosing among
Claude, OpenAI and Gemini models. Keep the existing forest palette, typography,
provider order, catalog routes and release tools.

The selected structure is three concise profiles, followed by task guidance and
the existing update feed. Each profile links to a pairwise comparison; `/compare`
supports any pair or all three, URL-backed selection, and differences-only mode.
On phones, compare one attribute across models at a time instead of scrolling a
wide table or reading three disconnected model summaries.

Three information structures were considered: a leaderboard, a task questionnaire,
and model profiles with an optional task guide. A leaderboard implies comparable
performance measurements we do not have. A questionnaire hides the models behind
extra steps. Profiles answer the user's primary request immediately and explain
tradeoffs without inventing a universal winner. This preserves the established
visual identity; it is not a new brand or an independently tested design trial.

The source-reviewed picks are Fable 5.1, Astra and Argon. “Frontier” here means the
provider's broadly documented demanding-work model, not necessarily its newest
or cheapest release. Anthropic's default recommendation, Opus 5.5, is explained
in Fable's tradeoff. Provider specifications and prices are factual; task guidance
is explicitly editorial. [Content maintenance](../../content/frontier-models.md)
records official sources and the manual update contract.

Acceptance: visible model names at the start; functional profile and comparison
links; explanations of task fit; clear price/limit conditions; shareable pairs;
mobile and keyboard usability; honest unavailable feed states; source date and
overdue review notice. No live DB writes, polling, infrastructure changes or
production publication are needed for implementation and validation.

Execution workspace: `/home/ubuntu/llm-tracker-frontier`, branch
`feature/frontier-models`, based on `010e957`. The original checkout and its
uncommitted guide changes are preserved. Temporary evidence belongs to this task
in `/tmp/llm-frontier-evidence`; retain logs, captures and receipts through handoff.
Dispose only of this task's dependencies/build outputs after preview and checks
are complete. Peak additional storage budget: 4 GiB, plus the shared reserve.

Validation results and delivery state will be recorded after execution. Initial
installs were refused because the shared storage lock belongs to the ZeroDay
finite-lab supervisor (PID 4084780); no outputs were created by those attempts.
The owning job was not changed. The user explicitly approved bounded concurrent
validation on October 14. Install/build/browser passes run sequentially within
this task, after a 4 GiB disk preflight and memory check, without changing the
ZeroDay job or shared lock. This is a task-specific exception, not host policy.
