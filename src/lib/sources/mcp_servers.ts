// Curated catalog of MCP servers for the landing-page "Top MCP servers" grid.
//
// Data flow:
//   1. Read `/content/mcp-overrides.json` — hand-curated pins (inserted verbatim)
//      + boost offsets + hide list.
//   2. Scrape the awesome-mcp-servers README for GitHub repo links (community).
//   3. For each non-hidden scraped repo, call `GET api.github.com/repos/...`
//      once to pick up stars + pushed_at. Up to GITHUB_CONCURRENCY in flight at
//      once — stays well under the 5k/hr authenticated budget for ~300 repos.
//   4. Compute rank = stars + (official ? 10000 : 0) + boost + recency_boost.
//   5. Upsert every row; emit `new_mcp_server` events on first insert.
//
// Fail-loud: throws if fewer than 10 rows total — markup on the awesome list
// likely broke. The 7 pinned reference servers alone are 7 rows, so 10 is a
// conservative floor that still catches total scrape failure.

import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { events, mcpServers } from "@/lib/db/schema";
import { fetchConditional } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";

const SOURCE_KEY = "mcp_servers";
const AWESOME_URL = "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md";
const OVERRIDES_PATH = path.join(process.cwd(), "content", "mcp-overrides.json");
const MIN_EXPECTED_ROWS = 10;
const MAX_COMMUNITY_REPOS = 300;
const GITHUB_API_BASE = "https://api.github.com/repos";
const GITHUB_CONCURRENCY = 8;

interface Overrides {
  pin?: Array<{
    id: string;
    name: string;
    description?: string;
    repoUrl: string;
    category?: string;
    installCmd?: string;
  }>;
  boost?: Record<string, number>;
  hide?: string[];
}

interface RepoMeta {
  stars: number | null;
  lastCommitAt: Date | null;
}

function loadOverrides(): Overrides {
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf8");
    return JSON.parse(raw) as Overrides;
  } catch {
    return {};
  }
}

/**
 * Extract `owner/repo` slugs from bulleted list items in the awesome-mcp-servers
 * README, scoped to category headings. Returns a Map keyed by slug so duplicates
 * collapse to the first-seen category.
 */
function extractCommunityServers(
  markdown: string,
): Map<string, { category: string | null; description: string | null; name: string }> {
  const result = new Map<string, { category: string | null; description: string | null; name: string }>();
  let currentCategory: string | null = null;
  const lines = markdown.split(/\r?\n/);
  const linkRe = /\[([^\]]+)\]\(https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/[^)]*)?\)/;

  for (const line of lines) {
    const cat = line.match(/^##+\s+(?:<a[^>]*>.*?<\/a>)?\s*([^\n]+)/);
    if (cat) {
      // Strip leading emojis / trailing trim from heading text.
      currentCategory = cat[1]!
        .replace(/<[^>]+>/g, "")
        .replace(/[^\x20-\x7e]/g, "")
        .trim() || null;
      continue;
    }
    if (!currentCategory) continue;
    // We only want actual server entries — bulleted lines whose first link
    // is a github.com repo.
    if (!/^\s*[-*]\s/.test(line)) continue;
    const m = line.match(linkRe);
    if (!m) continue;
    const [, linkText, owner, repo] = m;
    const slug = `${owner}/${repo}`.toLowerCase();
    if (result.has(slug)) continue;
    // Strip markdown formatting from the bullet line after the link to get a description.
    const afterLink = line.split(/\)\s*[-–—]\s*/, 2)[1] ?? "";
    const description = afterLink.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
    result.set(slug, {
      category: currentCategory,
      description,
      name: linkText ?? repo,
    });
  }
  return result;
}

async function fetchRepoMeta(slug: string, token: string | undefined): Promise<RepoMeta> {
  const url = `${GITHUB_API_BASE}/${slug}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "claude-tracker/0.1 (+https://claude.raizhost.com)",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { stars: null, lastCommitAt: null };
    if (!res.ok) return { stars: null, lastCommitAt: null };
    const body = (await res.json()) as { stargazers_count?: number; pushed_at?: string; archived?: boolean };
    if (body.archived) return { stars: null, lastCommitAt: null };
    return {
      stars: typeof body.stargazers_count === "number" ? body.stargazers_count : null,
      lastCommitAt: body.pushed_at ? new Date(body.pushed_at) : null,
    };
  } catch {
    return { stars: null, lastCommitAt: null };
  }
}

function computeRank(opts: {
  official: boolean;
  stars: number | null;
  lastCommitAt: Date | null;
  boost: number;
  pinIndex: number | null;
}): number {
  if (opts.pinIndex !== null) {
    // Pins get a huge rank floor, ordered by their pin list position.
    return 1_000_000 - opts.pinIndex;
  }
  const base = opts.stars ?? 0;
  const officialBonus = opts.official ? 10_000 : 0;
  let recencyBoost = 0;
  if (opts.lastCommitAt) {
    const days = (Date.now() - opts.lastCommitAt.getTime()) / (24 * 60 * 60 * 1000);
    recencyBoost = Math.max(0, 500 - days);
  }
  return Math.round(base + officialBonus + opts.boost + recencyBoost);
}

async function fetchAllRepoMeta(
  slugs: string[],
  token: string | undefined,
  concurrency: number,
): Promise<Map<string, RepoMeta>> {
  const out = new Map<string, RepoMeta>();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= slugs.length) return;
      const slug = slugs[i]!;
      out.set(slug, await fetchRepoMeta(slug, token));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, slugs.length) }, worker));
  return out;
}

export async function runMcpServers(): Promise<RunResult> {
  const overrides = loadOverrides();
  const boostMap = overrides.boost ?? {};
  const hideSet = new Set((overrides.hide ?? []).map((s) => s.toLowerCase()));
  const pins = overrides.pin ?? [];
  const pinIds = new Set(pins.map((p) => p.id.toLowerCase()));

  const awesomeRes = await fetchConditional(AWESOME_URL, `${SOURCE_KEY}_community`);
  let communityMap = new Map<string, { category: string | null; description: string | null; name: string }>();
  if (awesomeRes.body) {
    communityMap = extractCommunityServers(awesomeRes.body);
  } else if (!awesomeRes.unchanged) {
    throw new Error(`mcp_servers: awesome list returned status ${awesomeRes.status}`);
  }

  // Drop hidden ids and those already covered by pins.
  for (const slug of [...communityMap.keys()]) {
    if (hideSet.has(slug) || pinIds.has(slug)) communityMap.delete(slug);
  }

  // Cap to MAX_COMMUNITY_REPOS — take the first N in the README order to bound
  // API spend. The awesome list is roughly sorted by category then maintainer-preference.
  const communityEntries = [...communityMap.entries()].slice(0, MAX_COMMUNITY_REPOS);

  const token = process.env.GITHUB_TOKEN || undefined;
  const metaBySlug = await fetchAllRepoMeta(
    communityEntries.map(([s]) => s),
    token,
    GITHUB_CONCURRENCY,
  );

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const now = new Date();

  // Build the full target row set up front (pins + community), then partition
  // against a single bulk SELECT to avoid the prior N round-trips.
  type TargetRow = {
    id: string;
    name: string;
    description: string | null;
    repoUrl: string;
    stars: number | null;
    lastCommitAt: Date | null;
    official: boolean;
    category: string | null;
    installCmd: string | null;
    rank: number;
  };

  const targets: TargetRow[] = [];
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i]!;
    targets.push({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      repoUrl: p.repoUrl,
      stars: null,
      lastCommitAt: null,
      official: true,
      category: p.category ?? "reference",
      installCmd: p.installCmd ?? null,
      rank: computeRank({ official: true, stars: null, lastCommitAt: null, boost: 0, pinIndex: i }),
    });
  }
  for (const [slug, info] of communityEntries) {
    const meta = metaBySlug.get(slug) ?? { stars: null, lastCommitAt: null };
    targets.push({
      id: slug,
      name: info.name,
      description: info.description,
      repoUrl: `https://github.com/${slug}`,
      stars: meta.stars,
      lastCommitAt: meta.lastCommitAt,
      official: false,
      category: info.category,
      installCmd: null,
      rank: computeRank({
        official: false,
        stars: meta.stars,
        lastCommitAt: meta.lastCommitAt,
        boost: boostMap[slug] ?? 0,
        pinIndex: null,
      }),
    });
  }

  const ids = targets.map((t) => t.id);
  const existingIds = new Set(
    (await db.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, ids))).map((r) => r.id),
  );

  const newRows = targets.filter((t) => !existingIds.has(t.id));
  const existingRows = targets.filter((t) => existingIds.has(t.id));

  let inserted = 0;
  let updated = 0;

  if (newRows.length > 0) {
    await db.insert(mcpServers).values(
      newRows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        repoUrl: t.repoUrl,
        stars: t.stars,
        lastCommitAt: t.lastCommitAt,
        official: t.official,
        category: t.category,
        installCmd: t.installCmd,
        rank: t.rank,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    );
    inserted = newRows.length;

    await db
      .insert(events)
      .values(
        newRows.map((t) => ({
          source: SOURCE_KEY,
          type: "new_mcp_server",
          externalId: t.id,
          title: `New MCP server: ${t.name}`,
          bodyMd: t.description,
          url: t.repoUrl,
          publishedAt: now,
        })),
      )
      .onConflictDoNothing({ target: [events.source, events.externalId] });
  }

  for (const t of existingRows) {
    await db
      .update(mcpServers)
      .set({
        name: t.name,
        description: t.description,
        repoUrl: t.repoUrl,
        stars: t.stars,
        lastCommitAt: t.lastCommitAt,
        official: t.official,
        category: t.category,
        installCmd: t.installCmd,
        rank: t.rank,
        lastSeenAt: now,
      })
      .where(eq(mcpServers.id, t.id));
    updated++;
  }

  if (inserted + updated < MIN_EXPECTED_ROWS) {
    throw new Error(
      `mcp_servers: only ${inserted + updated} rows touched (< ${MIN_EXPECTED_ROWS}); awesome-list markup may have changed`,
    );
  }

  // Clear any stale rows that are now in the hide list.
  if (hideSet.size > 0) {
    await db.delete(mcpServers).where(inArray(mcpServers.id, [...hideSet]));
  }

  return { inserted, updated, skipped: 0, status: "ok" };
}
