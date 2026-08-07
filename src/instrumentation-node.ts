// Node-runtime-only instrumentation. Split out of `instrumentation.ts` so the
// Edge bundler (which now exists because `src/middleware.ts` is present) never
// traverses this module's `pg`/`node-cron` graph. `register()` imports this
// ONLY inside its `NEXT_RUNTIME === "nodejs"` branch — the documented Next.js
// pattern for keeping Node-only deps out of the edge compile.

export async function registerNode(): Promise<void> {
  // Skip cron during build — NEXT_PHASE is "phase-production-build" during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Deploy-time opt-out — short-lived runtimes (e.g. Lambda) set DISABLE_CRON=1
  // because an external scheduler owns polling there; an in-process node-cron
  // would just burn invocation time and duplicate work.
  if (process.env.DISABLE_CRON === "1") {
    console.log("[cron] DISABLE_CRON=1 — in-process poller scheduler disabled");
    return;
  }

  // Global flag — Next.js may invoke `register` multiple times in some setups
  // (dev HMR, multi-worker). Ensure we only start the scheduler once per process.
  const flag = "__CLAUDE_TRACKER_CRON_STARTED__";
  const g = globalThis as Record<string, unknown>;
  if (g[flag]) return;
  g[flag] = true;

  const { startCron } = await import("@/lib/poller/cron");
  startCron();
}
