import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse Next's built, source-only 404 document and existing layout. A rewritten
// static page overrides middleware's status/cache headers with 200/year-long
// caching. A response handler owns the actual 404 status without an SSG miss.
// The packaging guard checks this file in the standalone output.
let document: Promise<string> | undefined;
export async function GET(): Promise<Response> {
  document ??= readFile(path.join(process.cwd(), ".next/server/app/_not-found.html"), "utf8")
    .catch((error: unknown) => { document = undefined; throw error; });
  return new Response(await document, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=60",
      "X-Robots-Tag": "noindex",
    },
  });
}
