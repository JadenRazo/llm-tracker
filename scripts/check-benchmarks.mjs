import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Same shape as check-frontier.mjs. The database tests run only when
// FRONTIER_TEST_DATABASE_URL names the isolated localhost test database.
const directory = await mkdtemp(path.join(tmpdir(), "tracker-benchmark-tests-"));
try {
  const outfile = path.join(directory, "tests.cjs");
  await build({ entryPoints: ["scripts/benchmarks.test.ts"], outfile, bundle: true, platform: "node", format: "cjs", external: ["pg-native"], jsx: "automatic" });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
