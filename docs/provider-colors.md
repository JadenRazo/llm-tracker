# Recognizable provider colors

Provider references use Claude terracotta, OpenAI monochrome and Gemini's
four-color treatment. The dashboard keeps its existing forest background,
layout and semantic status colors. Names, selected states and native controls
remain visible without relying on color alone.

`getProviderStyle()` in `src/lib/provider-meta.ts` supplies two CSS variables:
`--provider-accent` is a solid, readable text/control tone; `--provider-mark`
is a decorative dot or card rule. Use the helper on mixed-provider components
and the shared provider layout on provider routes. Do not use gradients as text.

| Provider | Text/control color | Decorative treatment |
| --- | --- | --- |
| Claude | `#E99A7C` | Requested `#D97757` / `#C15F3C` terracotta tones |
| OpenAI / ChatGPT | `#F5F5F5` | Monochrome white on the dark surface |
| Gemini | `#8AB4F8` | Blue `#4285F4`, green `#34A853`, yellow `#FBBC05`, red `#EA4335` |

Gemini holds blue across the first quarter of its horizontal gradient so blue
stays visible in both small provider dots and thin card rules.

The three text colors have minimum contrast ratios of 6.11:1, 12.55:1 and
6.49:1 respectively across the background, card and raised surfaces. Claude's
`#C15F3C` remains decorative because it does not meet small-text AA here.
The product has a fixed dark theme; operating-system light preference does not
switch its palette.

References checked November 1, 2026: the owner's requested Claude palette,
[OpenAI's design guidelines](https://openai.com/brand/), and
[Google's four-color gradient design note](https://blog.google/company-news/inside-google/company-announcements/gradient-g-logo-design/).
These are dashboard accents, not altered provider logos or an affiliation claim.

The delivery plan is to apply the shared tokens to navigation, cards, comparisons,
activity, RSS choices and provider pages; check mobile/desktop behavior and
contrast; obtain independent review; publish through CI; then verify the served
assets and production data. Keep model/source identities and status colors intact.

## Release prerequisite

The existing production Gemini refresh was failing before this change, which
blocked the release gate. Google's current pricing markup repeats its search
billing footnote inside Standard and places an invite-only Contributor notice
in a separate tier. The parser accepts the exact reviewed footnote, keeps
non-Standard restrictions separate, and records the current token/tool billing
note. Unknown qualifiers and restrictions still reject publication.

The captured pricing excerpt in `scripts/fixtures/frontier/` and focused
regressions cover the new markup, old markup, altered footnotes, unrecognized
surcharges and Standard access restrictions. No release gate is relaxed.

## Verification record

Evidence for this release is retained at `/tmp/llm-provider-colors-evidence/`.
Typecheck, lint, UI/read regressions and the web/prerender/poller commands passed;
existing lint warnings are unchanged. The first coordinated build recorded a
successful child command but an orphaned worker at process closeout; its receipt
is preserved separately from later validation.

The generic marketing design gate reports the same two failures on production
and this candidate: existing small metadata text and em dashes. These are
unchanged dashboard conventions, not a claim that the marketing gate is green.
The project-specific browser matrix and independent review assess this narrow
palette update. Review and final delivery receipts carry the completed results.
