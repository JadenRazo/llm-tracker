// Node-runtime-only instrumentation. Split out of `instrumentation.ts` so the
// Edge bundler (which now exists because `src/middleware.ts` is present) never
// traverses this module's `pg`/`node-cron` graph. `register()` imports this
// ONLY inside its `NEXT_RUNTIME === "nodejs"` branch — the documented Next.js
// pattern for keeping Node-only deps out of the edge compile.

export async function registerNode(): Promise<void> {
  // Skip cron during build — NEXT_PHASE is "phase-production-build" during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Global flag — Next.js may invoke `register` multiple times in some setups
  // (dev HMR, multi-worker). Ensure we only start the scheduler once per process.
  const flag = "__CLAUDE_TRACKER_CRON_STARTED__";
  const g = globalThis as Record<string, unknown>;
  if (g[flag]) return;
  g[flag] = true;

  const { startCron } = await import("@/lib/poller/cron");
  startCron();
}
