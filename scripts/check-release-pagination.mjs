import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Use a synchronous child that is reaped before returning; this foreground
// check must not leave esbuild's unreferenced service on the shared host.
process.env.ESBUILD_WORKER_THREADS = "0";
const { buildSync } = await import("esbuild");

const directory = await mkdtemp(path.join(tmpdir(), "tracker-release-tests-"));
try {
  const outfile = path.join(directory, "tests.cjs");
  buildSync({
    entryPoints: ["scripts/release-pagination.test.ts"], outfile, bundle: true,
    platform: "node", format: "cjs",
    tsconfigRaw: { compilerOptions: { baseUrl: process.cwd(), paths: {
      "@/lib/db": ["scripts/fixtures/release-database.ts"],
      "@/lib/env": ["scripts/fixtures/release-database.ts"],
      "@/*": ["src/*"],
    } } },
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit", env: { PATH: process.env.PATH } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
