// Exercise the built server: rewrite tests alone cannot prove HTTP status or
// cache headers. Run without production credentials or in-process pollers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(root, ".next/standalone"),
  env: { PATH: process.env.PATH, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", DISABLE_CRON: "1", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-100_000); });
const exited = new Promise((resolve) => server.once("exit", resolve));
const request = (route, options = {}) => fetch(`http://localhost:${port}${route}`, { ...options, signal: AbortSignal.timeout(10_000) });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await request("/api/health")).status === 200; } catch { /* server starting */ }
    if (ready) break;
    assert.equal(server.exitCode, null, "Built server exited before readiness");
    await delay(100);
  }
  assert.ok(ready, "Built server did not become ready");
  const health = await (await request("/api/health")).json();
  assert.equal(health.db, "down", "Fixture must not connect to a real database");
  const unknown = ["/unknown-operational-fixture", "/missing.fixture", "/claude/guides/__hard_404__", "/openai/tips/missing", "/claude/status/extra", "/not-found-page"];
  for (const route of unknown) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=60", route);
    assert.equal(response.headers.get("x-robots-tag"), "noindex", route);
    assert.match(await response.text(), /<h3[^>]*>Page not found<\/h3>/, route);
  }
  assert.equal((await request(unknown[0], { method: "HEAD" })).status, 404);
  const required = JSON.parse(await readFile(path.join(root, ".next/required-server-files.json"), "utf8"));
  const articles = JSON.parse(required.config.env.STATIC_ARTICLE_ROUTES);
  assert.ok(articles.length > 0, "Article manifest must preserve existing content");
  for (const route of articles) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(await response.text(), /<h3[^>]*>Page not found<\/h3>/, route);
  }
  for (const route of ["/rss.xml", "/claude/rss.xml", "/icon.svg"]) assert.equal((await request(route)).status, 200, route);
  assert.ok(!logs.includes("NoFallbackError"), "Unknown routes attempted a nonexistent SSG fallback");
  console.log(`PASS: ${unknown.length} hard 404s, HEAD, ${articles.length} articles, feeds and metadata; no NoFallbackError. Isolated DB-free server only.`);
} finally {
  server.kill("SIGTERM");
  await Promise.race([exited, delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) { server.kill("SIGKILL"); await exited; }
}
