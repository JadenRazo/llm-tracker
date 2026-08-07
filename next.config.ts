import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
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
