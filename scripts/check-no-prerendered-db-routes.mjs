// CI guard: no database-backed route may be prerendered into the image.
//
// This is the check that would have caught the outage this repo just recovered
// from. Every DB-backed page was statically prerendered at build time, when CI
// has no DATABASE_URL, so the image shipped an EMPTY snapshot of every page.
// The Lambda's read-only filesystem then made regeneration non-durable, and any
// container with a cold cache served that empty snapshot — for up to a year,
// because Next's default `expireTime` emits a one-year stale-while-revalidate.
//
// A comment saying "keep these dynamic" is advice. This is the check.
//
// Run after `next build`; reads `.next/prerender-manifest.json`, which lists
// every route Next prerendered.

import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, ".next/prerender-manifest.json");

/**
 * Routes that MAY be prerendered: their content ships inside the image (MDX
 * under content/), so a build-time snapshot is correct by construction.
 * Anything else that reads the database must render per request.
 */
const ALLOWED = [
  /^\/_not-found$/,
  // Concrete paths from `routes`.
  /^\/(claude|openai|gemini)\/(tips|guides)$/,
  /^\/(claude|openai|gemini)\/(tips|guides)\/[^/]+$/,
  // Route templates from `dynamicRoutes` (the fallback/shell entries).
  /^\/\[\.\.\.notFound\]$/,
  /^\/\[provider\]\/(tips|guides)$/,
  /^\/\[provider\]\/(tips|guides)\/\[slug\]$/,
];

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (err) {
  console.error(
    `Could not read ${path.relative(root, manifestPath)} — run \`next build\` first.\n${err.message}`,
  );
  process.exit(1);
}

const prerendered = [
  ...Object.keys(manifest.routes ?? {}),
  ...Object.keys(manifest.dynamicRoutes ?? {}),
];

const offenders = prerendered.filter((route) => !ALLOWED.some((re) => re.test(route)));

if (offenders.length > 0) {
  console.error("These routes are prerendered but are not in the file-backed allow-list:\n");
  for (const route of offenders) console.error(`  ${route}`);
  console.error(
    "\nA database-backed route must NOT be prerendered: CI builds without DATABASE_URL,\n" +
      "so its snapshot is empty, and the Lambda's read-only filesystem cannot durably\n" +
      "replace it. Add `export const dynamic = \"force-dynamic\"` to the route and give it\n" +
      "an explicit Cache-Control in next.config.ts, or extend ALLOWED in this script if\n" +
      "the route genuinely reads no database.",
  );
  process.exit(1);
}

console.log(
  `OK — ${prerendered.length} prerendered route(s), all file-backed:\n${prerendered.map((r) => `  ${r}`).join("\n")}`,
);
