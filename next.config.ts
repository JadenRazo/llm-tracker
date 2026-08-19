import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // ISR entries live in memory, not on disk: the Lambda image filesystem is
  // read-only, so the default FileSystemCache failed every revalidation with
  // EROFS and pages were frozen at the build-time (empty-DB) prerender.
  // See cache-handler.cjs for the full story.
  cacheHandler: require.resolve("./cache-handler.cjs"),
  // Disable Next's built-in in-memory cache so the handler above is the one
  // source of truth (avoids double-caching with divergent lifetimes).
  cacheMaxMemorySize: 0,
  // Cap the `stale-while-revalidate` Next emits for the remaining ISR routes
  // (the MDX-backed tips/guides). The default `expireTime` is one YEAR, which let
  // CloudFront keep serving a single stale response long after `s-maxage` expired —
  // that is how empty pages survived at the edge for 25+ hours against s-maxage=60.
  // One hour is well past any deploy's propagation and bounds the blast radius.
  expireTime: 3600,
  // Pin workspace root to avoid Next.js picking up sibling lockfiles.
  outputFileTracingRoot: path.join(__dirname, "./"),
  // Packages that must stay external (not bundled) in server builds.
  serverExternalPackages: ["pg", "cheerio", "node-cron"],
  // Tree-shake barrel imports — without this, `import { Foo } from "lucide-react"`
  // can pull in the entire icon set during dev / SSR.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Phase 2.3: legacy Claude-only routes → their `/claude/...` equivalents.
  // Permanent (301) so search engines and bookmarks follow the rebrand. The
  // `/claude-code` ladder became `/claude/releases`.
  async redirects() {
    return [
      { source: "/claude-code", destination: "/claude/releases", permanent: true },
      { source: "/changelog", destination: "/claude/changelog", permanent: true },
      { source: "/models", destination: "/claude/models", permanent: true },
      { source: "/status", destination: "/claude/status", permanent: true },
      { source: "/guides", destination: "/claude/guides", permanent: true },
      {
        source: "/guides/:slug",
        destination: "/claude/guides/:slug",
        permanent: true,
      },
      { source: "/tips", destination: "/claude/tips", permanent: true },
      {
        source: "/tips/:slug",
        destination: "/claude/tips/:slug",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // ---- DB-backed pages ----------------------------------------------------
      // These render per request (`export const dynamic = "force-dynamic"`), so the
      // CDN — not Next's incremental cache — owns caching. Windows are matched to
      // each source's poll cadence and are deliberately SHORT: the previous setup
      // emitted `stale-while-revalidate=31535700` (Next's default `expireTime`),
      // which let CloudFront serve one unlucky empty response for up to a year.
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/:provider(claude|openai|gemini)",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/:provider(claude|openai|gemini)/changelog",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/:provider(claude|openai|gemini)/releases",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=300" },
        ],
      },
      {
        // Status is the most time-sensitive surface — polled every 10 minutes.
        source: "/:provider(claude|openai|gemini)/status",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=120" },
        ],
      },
      {
        // The model catalog changes a handful of times per year; polled every 30 min.
        source: "/:provider(claude|openai|gemini)/models",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=600, stale-while-revalidate=1800" },
        ],
      },
      {
        // Next's hashed static bundles are immutable — let browsers + CDNs cache them forever.
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
