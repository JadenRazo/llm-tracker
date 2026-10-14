import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function assertFrontierStatus(value, now = Date.now()) {
  const status = value.frontier ?? value;
  assert.equal(status.ok, true, "Frontier refresh is degraded");
  assert.equal(status.providers?.length, 3, "All three accepted profiles are required");
  assert.deepEqual(status.providers.map((p) => p.provider).sort(), ["claude", "gemini", "openai"]);
  for (const profile of status.providers) {
    assert.equal(profile.status, "current", `${profile.provider}: fallback/stale/failed data is not release-ready`);
    assert.match(profile.modelId, /^(claude|gpt|gemini)-[a-z0-9.-]+$/);
    assert.match(profile.revisionId, /^[a-f0-9]{64}$/);
    const age = now - Date.parse(profile.verifiedAt);
    assert.ok(Number.isFinite(age) && age >= -60_000 && age < 6 * 3600_000, "Verification must be recent and real");
    assert.ok(profile.sourceHashes.length >= 2 && profile.sourceHashes.length <= 4);
    for (const source of profile.sourceHashes) {
      assert.match(source.hash, /^[a-f0-9]{64}$/);
      assert.equal(new URL(source.url).protocol, "https:");
    }
  }
  return status.providers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertFrontierStatus(JSON.parse(readFileSync(process.argv[2], "utf8")));
  console.log("All three frontier profiles are current, source-backed database revisions.");
}
