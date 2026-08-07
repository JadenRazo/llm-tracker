// Next.js instrumentation hook — runs once when the server starts. Boots the
// node-cron scheduler on the Node runtime only.
//
// The Node-only work lives in `./instrumentation-node` and is imported ONLY
// inside the `NEXT_RUNTIME === "nodejs"` branch. With `src/middleware.ts`
// present, Next compiles instrumentation for the Edge runtime too; gating the
// import positively on the Node runtime lets the edge compiler tree-shake the
// branch so it never follows the `pg`/`node-cron` graph (per Next.js docs).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
