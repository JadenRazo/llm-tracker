import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Same shape as check-release-pagination.mjs: a synchronous esbuild child, the
// database module replaced by a recording fixture, and no network.
process.env.ESBUILD_WORKER_THREADS = "0";
const { buildSync } = await import("esbuild");

const directory = await mkdtemp(path.join(tmpdir(), "tracker-model-discovery-tests-"));
try {
  const outfile = path.join(directory, "tests.cjs");
  buildSync({
    entryPoints: ["scripts/model-discovery.test.ts"], outfile, bundle: true,
    platform: "node", format: "cjs", external: ["pg-native"],
    tsconfigRaw: { compilerOptions: { baseUrl: process.cwd(), paths: {
      "@/lib/db": ["scripts/fixtures/catalog-database.ts"],
      "@/lib/env": ["scripts/fixtures/catalog-database.ts"],
      "@/*": ["src/*"],
    } } },
  });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit", env: { PATH: process.env.PATH } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
