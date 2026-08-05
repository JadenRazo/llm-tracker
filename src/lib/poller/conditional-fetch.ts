// HTTP fetch helper with ETag / Last-Modified reuse.
//
// Looks up the most recent successful poller_runs row for a given sourceKey,
// sends its etag as If-None-Match and its last_modified as If-Modified-Since,
// and returns an "unchanged" marker on 304 so callers can skip parsing.
//
// Caches the {etag, lastModified} per sourceKey in-process so subsequent runs
// skip the per-fetch DB round-trip. Filters to status=ok/unchanged so a prior
// "error" row (etag=null) doesn't clobber valid cache headers.

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { tryGetDb } from "@/lib/db";
import { pollerRuns } from "@/lib/db/schema";

export interface ConditionalFetchResult {
  status: number;
  body?: string;
  etag?: string;
  lastModified?: string;
  unchanged: boolean;
}

export interface ConditionalFetchOptions {
  headers?: Record<string, string>;
  /** Total request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Max retry attempts on 5xx / network errors. Default 2. */
  maxRetries?: number;
}

const headerCache = new Map<string, { etag?: string; lastModified?: string }>();

async function loadCacheHeaders(sourceKey: string): Promise<{ etag?: string; lastModified?: string }> {
  const cached = headerCache.get(sourceKey);
  if (cached) return cached;

  const db = tryGetDb();
  if (!db) {
    headerCache.set(sourceKey, {});
    return {};
  }
  try {
    const rows = await db
      .select({ etag: pollerRuns.etag, lastModified: pollerRuns.lastModified })
      .from(pollerRuns)
      .where(and(eq(pollerRuns.source, sourceKey), inArray(pollerRuns.status, ["ok", "unchanged"])))
      .orderBy(desc(pollerRuns.startedAt))
      .limit(1);
    const row = rows[0];
    const value: { etag?: string; lastModified?: string } = row
      ? { etag: row.etag ?? undefined, lastModified: row.lastModified ?? undefined }
      : {};
    headerCache.set(sourceKey, value);
    return value;
  } catch {
    headerCache.set(sourceKey, {});
    return {};
  }
}

function jitterDelay(attempt: number): number {
  // 250ms * 2^attempt with 30% jitter.
  const base = 250 * 2 ** attempt;
  return base + Math.random() * base * 0.3;
}

export async function fetchConditional(
  url: string,
  sourceKey: string,
  options: ConditionalFetchOptions = {},
): Promise<ConditionalFetchResult> {
  const { etag, lastModified } = await loadCacheHeaders(sourceKey);
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const headers: Record<string, string> = {
    "User-Agent": "claude-tracker/0.1 (+https://llm.raizhost.com)",
    ...(options.headers ?? {}),
  };
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  let attempt = 0;
  let lastError: unknown;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });

      if (res.status >= 500 && attempt < maxRetries) {
        attempt++;
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, jitterDelay(attempt)));
        continue;
      }

      if (res.status === 304) {
        const result: ConditionalFetchResult = {
          status: 304,
          etag: res.headers.get("etag") ?? etag,
          lastModified: res.headers.get("last-modified") ?? lastModified,
          unchanged: true,
        };
        headerCache.set(sourceKey, { etag: result.etag, lastModified: result.lastModified });
        return result;
      }

      const body = res.ok ? await res.text() : undefined;
      const result: ConditionalFetchResult = {
        status: res.status,
        body,
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
        unchanged: false,
      };
      if (res.ok) {
        headerCache.set(sourceKey, { etag: result.etag, lastModified: result.lastModified });
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) {
        clearTimeout(timer);
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      }
      attempt++;
      await new Promise((r) => setTimeout(r, jitterDelay(attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
