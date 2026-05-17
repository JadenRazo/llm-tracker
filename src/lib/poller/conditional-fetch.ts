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

// Hard cap on a response body. Upstream feeds are JSON/markdown/RSS in the
// low-KB-to-low-MB range; anything past this is a misconfigured or hostile
// upstream and must not be buffered into memory unbounded.
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Reads the response body with a hard byte cap. Streams the body and aborts
 * once the cap is exceeded rather than buffering the whole thing first.
 * Returns null if the cap is exceeded (caller treats as a soft skip — same
 * shape as a non-ok response: no body), otherwise the decoded text.
 */
async function readCapped(res: Response, sourceKey: string): Promise<string | null> {
  if (!res.body) {
    // No stream (e.g. some runtimes on empty bodies) — fall back to text();
    // bounded by the Content-Length pre-check the caller already did.
    return res.text();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        // eslint-disable-next-line no-console
        console.warn(
          `[${sourceKey}] response body exceeded ${MAX_BODY_BYTES} bytes — aborting read (soft skip)`,
        );
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
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
    "User-Agent": "claude-tracker/0.1 (+https://claude.raizhost.com)",
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

      // Reject early on an over-cap Content-Length so we never start buffering
      // a huge body. Mirror the "no body" shape callers already soft-skip on
      // (status preserved, body undefined) rather than throwing out of the
      // poller — an oversized upstream is a skip, not a hard error.
      const contentLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        // eslint-disable-next-line no-console
        console.warn(
          `[${sourceKey}] Content-Length ${contentLength} exceeds ${MAX_BODY_BYTES} bytes — skipping (no body read)`,
        );
        return {
          status: res.status,
          body: undefined,
          etag: res.headers.get("etag") ?? undefined,
          lastModified: res.headers.get("last-modified") ?? undefined,
          unchanged: false,
        };
      }

      // Defensive cap on the actual read (handles chunked / missing
      // Content-Length). readCapped returns null past the cap → treat as a
      // soft skip by leaving body undefined.
      const text = res.ok ? await readCapped(res, sourceKey) : null;
      const body = text ?? undefined;
      const result: ConditionalFetchResult = {
        status: res.status,
        body,
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
        unchanged: false,
      };
      if (res.ok && body !== undefined) {
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
