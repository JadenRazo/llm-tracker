import { createHash } from "node:crypto";
import { allowedDocument, type FrontierProvider, type SourceDocument } from "./schema";

export const documentHash = (body: string) => createHash("sha256").update(body).digest("hex");
export interface DocumentStore {
  load(url: string): Promise<SourceDocument | null>;
  save(document: SourceDocument): Promise<void>;
}
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Durable validators and bodies travel together. No redirects or paid API calls. */
export function documentReader(provider: FrontierProvider, store: DocumentStore, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const deadline = now() + 45_000;
  let requests = 0;
  return async (url: string): Promise<SourceDocument> => {
    if (!allowedDocument(provider, url)) throw new Error("Document URL is not allowed");
    const cached = await store.load(url);
    const usable = cached && cached.body && documentHash(cached.body) === cached.hash ? cached : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (++requests > 8 || now() >= deadline) throw new Error("Frontier fetch budget exhausted");
      const headers: Record<string, string> = { "User-Agent": "llm-tracker/0.1 (+https://llm.raizhost.com)", Accept: url.endsWith(".md") ? "text/markdown" : "text/html" };
      if (attempt === 0 && usable?.etag) headers["If-None-Match"] = usable.etag;
      if (attempt === 0 && usable?.lastModified) headers["If-Modified-Since"] = usable.lastModified;
      const response = await fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - now()))) });
      if (response.status === 304) {
        if (usable) return usable;
        if (attempt === 0) continue;
        throw new Error("304 response has no retained matching source body");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Official document returned HTTP ${response.status}`);
      }
      if (Number(response.headers.get("content-length")) > MAX_BODY_BYTES) {
        await response.body?.cancel(); throw new Error("Official document exceeds 2 MiB limit");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Official document body missing");
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Official document exceeds 2 MiB limit"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body.trim()) throw new Error("Official document is empty");
      const result: SourceDocument = { url, body, hash: documentHash(body), etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined };
      await store.save(result);
      return result;
    }
    throw new Error("Document retrieval failed");
  };
}
