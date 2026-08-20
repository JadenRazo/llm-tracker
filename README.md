# LLM Tracker

Public, read-only multi-LLM dashboard served at `llm.raizhost.com` (the old
`claude.raizhost.com` 301-redirects here).

Tracks what's shipping across **Claude, OpenAI, and Gemini** — Claude Code and
Codex are the coding headliners. Polls a tiered set of per-provider data
sources (npm, GitHub, provider APIs, docs, status pages) on a schedule and
renders a cross-provider "what's new" feed, per-provider model catalogs, CLI
version timelines, and curated markdown tips/guides.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Drizzle
ORM · node-cron · cheerio · gray-matter · next-mdx-remote.

## Local development

```bash
cp .env.example .env            # fill in DATABASE_URL + ADMIN_TOKEN
npm install
createdb claude_tracker         # or CREATE DATABASE on your local postgres
npm run db:push                 # apply schema
npm run dev                     # http://localhost:3200
```

`createdb claude_tracker` is not a typo: the physical database keeps its original
name. Only the product is called LLM Tracker; renaming the database would be a
separate migration with no user-visible benefit.

Pages render without a database, but they distinguish the two cases:
`DATABASE_URL` missing or the query failing renders "temporarily unavailable"
(an outage on our side), while a successful query returning zero rows renders a
genuine empty state. Those must never be conflated — a database outage that
reads as "nothing has been ingested" is how a broken deploy looked like a new
site for weeks.

## Running a poller manually (dev / smoke test)

```bash
curl -X POST http://localhost:3200/api/admin/run-poller?source=npm_claude_code \
     -H "X-Admin-Token: $ADMIN_TOKEN"
```

The endpoint is guarded: it requires a matching `X-Admin-Token` header AND the caller
to be on localhost.

## Adding a curated tip or guide

1. Create `content/tips/my-tip.md` (or `content/guides/my-guide.md`).
2. Add frontmatter — see `content/tips/README.md` for the format.
3. Commit. The page lists/renders it on next build.

## Deploy

Production runs on AWS, not on the VPS. Pushing to `main` runs CI (typecheck /
lint / build); a green CI triggers `.github/workflows/deploy.yml`, which assumes
`raizcloud-claude-tracker-deploy` via GitHub OIDC, builds a native-arm64 image,
pushes it to ECR, syncs `.next/static` to S3, updates the Lambda, invalidates
CloudFront, and then smoke-tests the live site.

```
GitHub (main) ──OIDC──▶ ECR raizcloud/claude-tracker-web
                          │
                          ▼
CloudFront E1CNTRS4U5EXW7 ──▶ API Gateway ──▶ Lambda raizcloud-claude-tracker-web
  │                                              (arm64, Lambda Web Adapter,
  └── /_next/static/* ──▶ S3 assets bucket        DISABLE_CRON=1)
                                                     │
Polling is SEPARATE: three Lambdas                   ▼
raizcloud-claude-tracker-poller-t1/t2/t3 ──▶ Postgres on the anchor EC2
  (EventBridge: 10m / 30m / 2h)                (PgBouncer 10.20.0.249:6432)
```

### The pollers ship with the site

The three scheduled poller functions (`raizcloud-claude-tracker-poller-t1/t2/t3`
— Zip, nodejs22.x, arm64, handler `index.handler`, tier chosen by the `TIER` env
var) are built by `npm run build:poller` (esbuild bundle of
`src/lib/poller/lambda.ts`) and updated in the same deploy job, then invoked once
each so a bundling mistake fails the pipeline instead of surfacing silently on
the next EventBridge tick.

Before this existed the pollers had **no deploy path at all**: they were
hand-uploaded artifacts last modified 2026-06-22 while `deploy.yml` only updated
the web image, so the ingest half of the tracker ran code nobody could point at
and no source fix in this repo could reach it. Do not remove those steps — a
poller change that is not deployed looks exactly like a poller change that does
not work.

### AWS resource names

The AWS resource names still contain `claude-tracker`, even though the GitHub
repository was renamed to `llm-tracker` on 2026-08-20. That is deliberate: Lambda
functions, ECR repositories, S3 buckets and IAM roles cannot be renamed in place,
so changing them means destroying and recreating roughly eighteen live resources
with downtime, for strings no user ever sees. They are managed by Terraform in
`JadenRazo/aws-infra` (`phase-e-claude-tracker.tf`); rename them there or not at
all.

**The deploy role's OIDC trust policy pins
`token.actions.githubusercontent.com:sub` to
`repo:JadenRazo/llm-tracker:ref:refs/heads/main`. Renaming this repository again
without widening that trust policy first will break every deploy** — the token
GitHub mints carries the new repo name, and the role will refuse it. Widen the
policy to accept both names, rename, verify a deploy, then tighten it back.

### Rendering contract — do not reintroduce ISR here

Every database-backed route sets `export const dynamic = "force-dynamic"` and
gets an explicit `Cache-Control` in `next.config.ts`. This is not a style
preference:

* The Lambda runs a container image with a **read-only filesystem**, so Next's
  incremental cache cannot persist a regeneration. `cache-handler.cjs` keeps
  regenerations in a per-container memory Map, which dies with the container.
* CI builds with **no `DATABASE_URL`** (by design — the build must not need the
  VPC), so the prerender baked into the image is EMPTY.
* Together those meant any container with a cold cache served empty pages, and
  CloudFront pinned whichever response it happened to draw for up to a year via
  Next's default `expireTime` (`stale-while-revalidate=31535700`).

`expireTime` is now capped at one hour, the CDN windows are short and explicit,
and the deploy smoke test fails if any page renders an empty state.

The legacy VPS path (`docker compose up -d --build` behind Caddy, vhost at
`deploy/caddy/llm.raizhost.com.Caddyfile`) still works for local or fallback
hosting, and that Caddyfile is where the `claude.raizhost.com` → `llm.raizhost.com`
301 lives. It is NOT how production is served.

## Feeds

`/rss.xml` is the cross-provider feed; `/claude/rss.xml`, `/openai/rss.xml`, and
`/gemini/rss.xml` are per-provider. All four are advertised in `<head>` for
reader autodiscovery.

## Health

`GET /api/health` reports database reachability, the age of the most recent
poller run, and any source that is currently failing or has never run. It always
returns HTTP 200 — the Lambda Web Adapter readiness check and the Docker
HEALTHCHECK both hit it, and failing those over a degraded dependency would turn
a degraded site into a total outage. Monitors must assert on `"ok":true` in the
body, not on the status code.

## Mobile responsiveness

Three load-bearing rules — break them and the site goes out of view on phones:

1. **Long monospace strings inside flex rows** must be wrapped:
   `<div className="min-w-0 flex-1"><code className="break-all">…</code></div>`.
   See `src/components/model-table.tsx` for the canonical example.
2. **Tables**: never ship a raw `<table>` to mobile. Pattern: `lg:hidden` mobile
   card list above, `hidden lg:block` desktop table inside `overflow-x-auto`.
3. **Portaled popovers** (tooltips, menus, dialogs): clamp width *and* height to
   the viewport, and clamp computed `top`/`left` to
   `[VIEWPORT_MARGIN, viewport - size - VIEWPORT_MARGIN]`. Never use
   `pointer-events-none` on a popover whose outside-click handler depends on
   the popover being a real hit target. See `src/components/home/command-chip.tsx`.
