// Next.js instrumentation hook — runs once when the server starts.
// Used to boot the node-cron scheduler on the Node runtime only (not edge).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
