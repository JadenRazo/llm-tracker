// Validates one poller Lambda's invoke response during deploy.
//   node scripts/assert-poller-invoke.mjs <function-name> <response.json>
//
// What this gate is for: proving the DEPLOYED CODE runs and uses its tier list.
// It deliberately does NOT fail on a flaky upstream. The seven GitHub-backed
// sources share a single unauthenticated 60-request/hour budget on the NAT's IP,
// so a burst of invocations 403s them for the rest of the hour — which says
// nothing about the build being deployed.
//
// Fails only on what the deploy controls:
//   - the tier ran the wrong number of sources (the `aws.scheduler` envelope
//     regression, where the event's own `source` field hijacked the override and
//     every scheduled tick ran one phantom source instead of the tier)
//   - EVERY source failed (systemic: no egress, no database, bad bundle)
//
// Individual source failures are emitted as GitHub warnings; /api/health is what
// tracks them over time.

import { readFile } from "node:fs/promises";

const [fn, responsePath] = process.argv.slice(2);
if (!fn || !responsePath) {
  console.error("usage: assert-poller-invoke.mjs <function-name> <response.json>");
  process.exit(2);
}

/**
 * Source counts per tier, generated from the registry by build-poller.mjs. Read
 * from disk rather than written here: a hand-maintained copy goes stale the
 * first time a source is added, which is exactly how adding `openai_models` to
 * tier 3 failed a deploy whose poller run was entirely healthy.
 */
let EXPECTED_SOURCES = {};
try {
  const manifest = JSON.parse(
    await readFile(new URL("../poller-manifest.json", import.meta.url), "utf8"),
  );
  EXPECTED_SOURCES = manifest.tierSourceCounts ?? {};
} catch {
  console.log("::warning::poller-manifest.json not found — skipping the per-tier source-count check");
}

let result;
try {
  result = JSON.parse(await readFile(responsePath, "utf8"));
} catch (err) {
  console.error(`::error::${fn} returned a response that is not JSON: ${err.message}`);
  process.exit(1);
}

const { tier, err = 0, sources = [] } = result;
const ran = sources.length;
const expected = EXPECTED_SOURCES[tier];

if (expected !== undefined && ran !== expected) {
  console.error(
    `::error::${fn} (tier ${tier}) ran ${ran} source(s), expected ${expected} — the tier list was not used`,
  );
  process.exit(1);
}

if (ran > 0 && err === ran) {
  console.error(
    `::error::${fn} (tier ${tier}) had ALL ${ran} sources fail — systemic, not a flaky upstream`,
  );
  for (const s of sources) console.error(`::error::  ${s.source}: ${s.error}`);
  process.exit(1);
}

for (const s of sources) {
  if (s.error) console.log(`::warning::${fn} source ${s.source} failed: ${s.error}`);
}

console.log(`${fn}: tier ${tier}, ${ran} source(s) ran, ${err} failing (tolerated)`);
