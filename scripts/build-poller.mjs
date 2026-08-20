// Bundles src/lib/poller/lambda.ts into a single CommonJS file for the three
// scheduled poller Lambdas (nodejs22.x, arm64, handler `index.handler`).
//
// The deployed functions are Zip packages, not container images, and before this
// script existed they had no build step in the repo at all — see the header of
// src/lib/poller/lambda.ts. Bundling (rather than shipping node_modules) keeps
// the artifact close to the ~684 KB zip already deployed and avoids carrying
// Next.js, React, and the whole app tree into a job that only needs the source
// modules, drizzle, pg and cheerio.

import { build } from "esbuild";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { deflateRawSync, crc32 } from "node:zlib";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Minimal ZIP writer (deflate). Written in-process rather than shelling out to
 * `zip`, which is not installed on every runner or dev box and would make the
 * build fail in a way that looks like a code error.
 */
function zipFiles(entries, mtime = new Date(0)) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, contents] of entries) {
    const { local, central, size } = zipEntry(name, contents, mtime, offset);
    locals.push(local);
    centrals.push(central);
    offset += size;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

function zipEntry(name, contents, mtime, offset) {
  const nameBytes = Buffer.from(name, "utf8");
  const deflated = deflateRawSync(contents, { level: 9 });
  const crc = crc32(contents);

  // DOS time/date. Fixed epoch keeps the artifact byte-reproducible.
  const dosTime =
    ((mtime.getUTCHours() << 11) | (mtime.getUTCMinutes() << 5) | (mtime.getUTCSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((mtime.getUTCFullYear() - 1980) << 9) | ((mtime.getUTCMonth() + 1) << 5) | mtime.getUTCDate()) & 0xffff;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // method: deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28); // extra length

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory signature
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk number
  central.writeUInt16LE(0, 36); // internal attrs
  // External attrs: 0644 regular file, shifted into the unix high word.
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42); // local header offset

  return {
    local: Buffer.concat([local, nameBytes, deflated]),
    central: Buffer.concat([central, nameBytes]),
    size: local.length + nameBytes.length + deflated.length,
  };
}
const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, ".poller-build");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, "src/lib/poller/lambda.ts")],
  outfile: path.join(outDir, "index.js"),
  bundle: true,
  platform: "node",
  // Matches the deployed functions' runtime (nodejs22.x).
  target: "node22",
  // The Lambda handler contract is CommonJS `exports.handler`.
  format: "cjs",
  // arm64 functions; esbuild output is platform-neutral JS, but pg/cheerio must
  // be bundled rather than left external because there is no node_modules in the
  // zip. `pg-native` is an optional peer pg never requires unless asked for.
  external: ["pg-native"],
  minify: false, // keep stack traces readable in CloudWatch
  sourcemap: false,
  metafile: true,
  logLevel: "info",
  // Mirrors tsconfig's "@/*" -> "src/*" path alias.
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`bundled index.js: ${(bytes / 1024).toFixed(0)} KB`);

const zipPath = path.join(root, "poller.zip");
await rm(zipPath, { force: true });
const bundleSource = await readFile(path.join(outDir, "index.js"));
// This repo is `"type": "module"`, so a bare `index.js` would be read as ESM and
// the CommonJS `exports.handler` the Lambda runtime looks for would not exist.
// Ship an explicit `{"type":"commonjs"}` beside it rather than relying on the
// zip happening to contain no package.json.
const pollerPackageJson = Buffer.from(
  `${JSON.stringify({ name: "llm-tracker-poller", private: true, type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
await writeFile(
  zipPath,
  zipFiles([
    ["index.js", bundleSource],
    ["package.json", pollerPackageJson],
  ]),
);
// Same files on disk, so the local load check below sees what Lambda will.
await writeFile(path.join(outDir, "package.json"), pollerPackageJson);

// Fail loudly on an implausible artifact rather than shipping a broken poller.
const { size } = await stat(zipPath);
if (size < 50_000) {
  throw new Error(`poller.zip is only ${size} bytes — the bundle is almost certainly incomplete`);
}
// Guard the handler contract by LOADING the bundle, not by grepping it: the
// deployed functions are configured with `index.handler`, and a bundle that
// merely mentions the word would still fail at runtime. Requiring it also
// surfaces any top-level import that blows up before the first invocation.
const loaded = createRequire(import.meta.url)(path.join(outDir, "index.js"));
if (typeof loaded.handler !== "function") {
  throw new Error(
    `bundle does not export a callable \`handler\` (got ${typeof loaded.handler}) — check the esbuild entrypoint/format`,
  );
}
console.log(`poller.zip: ${(size / 1024).toFixed(0)} KB`);

// Emit the tier->source-count manifest the deploy's invoke assertion reads, so
// that expectation is generated from the registry rather than hand-maintained.
const manifestPath = path.join(root, "poller-manifest.json");
await writeFile(
  manifestPath,
  `${JSON.stringify({ tierSourceCounts: loaded.TIER_SOURCE_COUNTS }, null, 2)}\n`,
);
console.log(`tier source counts: ${JSON.stringify(loaded.TIER_SOURCE_COUNTS)}`);
await writeFile(path.join(outDir, "meta.json"), JSON.stringify(result.metafile, null, 2));
