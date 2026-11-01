// Polls GitHub's /repos/openai/codex/releases endpoint.
// Mirrors claude/github_releases.ts (auth + per-key ETag), but per the
// Phase 2.2 decision the Codex release bodies are ~empty, so we store only
// version/tag + a link to the GitHub release + the published date. We do NOT
// fabricate a notes body — bodyMd stays null.
// Uses GITHUB_TOKEN if set (5000/hr); otherwise unauthenticated (60/hr).

import { z } from "zod";
import { tryGetDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fetchConditional, loadPersistedCacheHeaders } from "@/lib/poller/conditional-fetch";
import type { RunResult } from "@/lib/poller/runner";
import type { Provider } from "@/lib/providers";
import type { SourceDescriptor } from "@/lib/sources/registry";

const SOURCE_KEY = "openai_codex_releases";
const PROVIDER: Provider = "openai";
const REPO = "openai/codex";

// GitHub releases API is untrusted upstream — validate before reading.
// Zod strips extra fields, including large asset metadata we never store.
const githubReleaseSchema = z
  .object({
    id: z.number(),
    tag_name: z.string(),
    name: z.string().nullable(),
    body: z.string().nullable(),
    html_url: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullable(),
    created_at: z.string(),
  });

const githubReleasesSchema = z.array(githubReleaseSchema);

type GithubRelease = z.infer<typeof githubReleaseSchema>;
const pageCacheSchema = z.array(z.object({
  etag: z.string().optional(), lastModified: z.string().optional(), count: z.number().int().min(0).max(5),
})).max(4);
const PAGE_CACHE_PREFIX = '"release-pages-v1:';

export async function runOpenaiCodexReleases(): Promise<RunResult> {
  const token = env().GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // The twenty-release payload outgrew the shared 10 MiB cap. Preserve the
  // same scope with at most four five-release pages, without raising the cap.
  // No page retry: four 5s request deadlines bound HTTP time to 20s. Fetch and
  // validate every needed page before the single idempotent database write.
  const releases: GithubRelease[] = [];
  // Store the page validators together in the existing successful-run ETag
  // field. A legacy single-response ETag triggers a complete bounded refresh.
  // Each page must be checked: an older draft may become public while page 1
  // remains unchanged. Never send this opaque manifest as an HTTP header.
  const persisted = await loadPersistedCacheHeaders(SOURCE_KEY);
  let priorPages: z.infer<typeof pageCacheSchema> = [];
  if (persisted.etag?.startsWith(PAGE_CACHE_PREFIX) && persisted.etag.endsWith('"') && persisted.etag.length <= 8192) {
    try {
      const manifest = Buffer.from(persisted.etag.slice(PAGE_CACHE_PREFIX.length, -1), "base64url").toString("utf8");
      const parsed = pageCacheSchema.safeParse(JSON.parse(manifest));
      if (parsed.success) priorPages = parsed.data;
    } catch { /* Invalid cache metadata is safely refetched. */ }
  }
  const nextPages: z.infer<typeof pageCacheSchema> = [];
  let changed = false;
  for (let page = 1; page <= 4; page++) {
    const url = `https://api.github.com/repos/${REPO}/releases?per_page=5&page=${page}`;
    const prior = priorPages[page - 1];
    const res = await fetchConditional(url, page === 1 ? SOURCE_KEY : `${SOURCE_KEY}:page-${page}`, {
      headers, cacheHeaders: prior ?? {}, maxRetries: 0, timeoutMs: 5_000,
    });
    if (res.unchanged) {
      if (!prior) throw new Error(`${REPO} releases page ${page} returned 304 without committed cache metadata`);
      nextPages.push({ etag: res.etag, lastModified: res.lastModified, count: prior.count });
      if (prior.count < 5) break;
      continue;
    }
    changed = true;
    if (res.oversized) throw new Error(`${REPO} releases page ${page} exceeded the response body cap`);
    if (!res.body || res.status !== 200) throw new Error(`${REPO} releases page ${page} returned unusable status ${res.status}`);
    let raw: unknown;
    try { raw = JSON.parse(res.body); }
    catch { throw new Error(`${REPO} releases page ${page} returned non-JSON body`); }
    const parsed = githubReleasesSchema.safeParse(raw);
    if (!parsed.success || parsed.data.length > 5) throw new Error(`${REPO} releases page ${page} failed schema validation`);
    nextPages.push({ etag: res.etag, lastModified: res.lastModified, count: parsed.data.length });
    releases.push(...parsed.data);
    if (parsed.data.length < 5) break;
  }
  // A quoted opaque tag is syntactically safe even for the old adapter on
  // rollback; it cannot match GitHub's old twenty-release response validator.
  const etag = PAGE_CACHE_PREFIX + Buffer.from(JSON.stringify(nextPages)).toString("base64url") + '"';

  const db = tryGetDb();
  if (!db) return { inserted: 0, updated: 0, skipped: 1, status: "skipped" };

  const publishable = releases.filter((r) => !r.draft);
  const draftSkipped = releases.length - publishable.length;
  if (publishable.length === 0) {
    return { inserted: 0, updated: 0, skipped: draftSkipped, status: changed ? "ok" : "unchanged", etag };
  }

  const rows = publishable.map((rel) => {
    // Guard against a malformed upstream date (fall back to null rather than
    // writing an Invalid Date — siblings let detectedAt stand in).
    const rawDate = rel.published_at ?? rel.created_at;
    const d = new Date(rawDate);
    const publishedAt = Number.isNaN(d.getTime()) ? null : d;
    return {
      source: SOURCE_KEY,
      type: rel.prerelease ? "prerelease" : "release",
      externalId: `${REPO}:${rel.tag_name}`,
      title: rel.name && rel.name.trim().length > 0 ? rel.name : `${REPO} ${rel.tag_name}`,
      // Codex release bodies are effectively empty — store only the link, no
      // synthesized notes (Phase 2.2 user decision).
      bodyMd: null,
      url: rel.html_url,
      publishedAt,
      provider: PROVIDER,
    };
  });

  const inserted = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  return {
    inserted: inserted.length,
    updated: 0,
    skipped: draftSkipped + (publishable.length - inserted.length),
    status: "ok",
    etag,
  };
}

export const openaiCodexReleasesSource: SourceDescriptor = {
  key: SOURCE_KEY,
  provider: PROVIDER,
  tier: 2,
  run: runOpenaiCodexReleases,
};
