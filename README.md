# claude-tracker

Public, read-only Claude ecosystem dashboard served at `llm.raizhost.com`.

Polls a tiered set of data sources (npm, GitHub, Anthropic API, docs, status page) on a
schedule and renders an aggregated feed, a model catalog, the Claude Code version
timeline, and curated markdown tips/guides.

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

A DB is not strictly required to render pages — every page falls back to a "No data
yet — poller is warming up" placeholder when `DATABASE_URL` is missing or unreachable.

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

`docker compose up -d --build` after copying `.env.example` to `.env` and filling it
in. Caddy terminates TLS in front of port 3200.

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
