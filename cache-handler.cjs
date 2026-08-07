/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose:
   Next loads the cacheHandler file with require() at server boot. */
// Read-through incremental cache for read-only runtimes (Lambda container
// images).
//
// Next's default FileSystemCache persists ISR regenerations by writing into
// .next/server/app/** — which is read-only inside the Lambda image, so every
// background revalidation failed with EROFS and the site served the build-time
// (empty-DB) prerender forever.
//
// This handler splits the two halves:
//   reads  — memory first (fresh regenerations), then the on-disk build seed
//            via Next's own FileSystemCache (reads are fine on a read-only
//            FS, and SSG'd dynamic routes 404 with NoFallbackError if their
//            prerendered entry can't be found at all);
//   writes — memory only, so revalidation succeeds instead of EROFS-ing.
//
// The disk entry's stale lastModified is what triggers the first
// revalidation; after that the memory entry wins. The store is module-scope
// so it survives however many handler instances Next constructs within one
// container; entry count is bounded by the route table, so no eviction.
// CloudFront (s-maxage) absorbs the per-container fan-out.

let FileSystemCache = null;
try {
  const mod = require("next/dist/server/lib/incremental-cache/file-system-cache");
  FileSystemCache = mod.default ?? mod;
} catch {
  // Next internals moved — degrade to memory-only. SSG'd routes would 404 on
  // cold containers in that state, so fail loudly enough to notice in logs.
  console.error(
    "[cache-handler] could not load Next FileSystemCache — running memory-only",
  );
}

const store = new Map();

module.exports = class ReadThroughMemoryCacheHandler {
  constructor(options) {
    this.options = options;
    // Next instantiates a custom handler with the same context it would hand
    // the default FileSystemCache, so pass it straight through.
    this.disk = FileSystemCache ? new FileSystemCache(options) : null;
  }

  async get(...args) {
    const hit = store.get(args[0]);
    if (hit) return hit;
    if (!this.disk) return null;
    try {
      return await this.disk.get(...args);
    } catch {
      return null;
    }
  }

  async set(key, data, ctx) {
    store.set(key, {
      value: data,
      lastModified: Date.now(),
      tags: ctx?.tags ?? [],
    });
  }

  async revalidateTag(tags) {
    const wanted = [tags].flat();
    for (const [key, entry] of store) {
      if (entry.tags?.some((t) => wanted.includes(t))) store.delete(key);
    }
    // Disk entries can't be invalidated on a read-only FS; memory entries
    // written after this point shadow them, and this app never calls
    // revalidateTag anyway.
  }

  resetRequestCache() {
    this.disk?.resetRequestCache?.();
  }
};
