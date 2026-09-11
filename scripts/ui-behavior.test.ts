import assert from "node:assert/strict";
import { test } from "node:test";
import { isSectionActive, swapProviderInPath } from "@/lib/provider-route";
import { PROVIDERS } from "@/lib/providers";
import { stableCliVersion } from "@/lib/stable-cli";
import { buildActivity, filterActivity } from "@/lib/activity";
import {
  capabilityOptions,
  formatContext,
  selectModels,
} from "@/lib/model-catalog";
import type { Event, Model } from "@/lib/db/schema";

const date = new Date("2026-09-01T12:00:00Z");
const event = (values: Partial<Event>): Event => ({
  id: 1,
  provider: "claude",
  source: "npm_claude_code",
  type: "release",
  externalId: "2.1.0",
  title: "v2.1.0",
  url: "https://example.com/npm",
  bodyMd: null,
  detectedAt: date,
  publishedAt: date,
  contentHash: null,
  ...values,
});
const model = (values: Partial<Model>): Model => ({
  id: "example",
  displayName: "Example",
  provider: "claude",
  firstSeenAt: date,
  lastSeenAt: date,
  contextWindow: null,
  maxOutput: null,
  pricingIn: null,
  pricingOut: null,
  capabilities: {},
  ...values,
});

test("a prerelease fallback is never labelled as a stable CLI release", () => {
  assert.equal(stableCliVersion("0.2.0-alpha.1"), null);
  assert.equal(stableCliVersion("0.2.0-nightly.20260911"), null);
  assert.equal(stableCliVersion("v1.2.3"), "1.2.3");
  assert.equal(stableCliVersion("1.2.3+build-meta"), "1.2.3+build-meta");
  assert.equal(stableCliVersion(null), null);
});

test("each provider page activates exactly one section, including nested articles and trailing slashes", () => {
  const sections = [
    "",
    "/models",
    "/releases",
    "/tips",
    "/guides",
    "/changelog",
    "/status",
  ];
  for (const p of PROVIDERS)
    for (const section of sections) {
      const path = `/${p}${section}`;
      assert.deepEqual(
        sections.filter((s) => isSectionActive(path, p, s)),
        [section],
      );
      assert.deepEqual(
        sections.filter((s) => isSectionActive(path + "/", p, s)),
        [section],
      );
    }
  assert.equal(
    isSectionActive("/claude/guides/setup", "claude", "/guides"),
    true,
  );
  assert.equal(
    isSectionActive("/claude/models-extra", "claude", "/models"),
    false,
  );
  assert.equal(isSectionActive("/", "claude", ""), false);
});
test("provider switches retain the section but do not carry foreign article slugs", () => {
  assert.equal(
    swapProviderInPath("/claude/models", "gemini"),
    "/gemini/models",
  );
  assert.equal(
    swapProviderInPath("/claude/guides/setup", "openai"),
    "/openai/guides",
  );
  assert.equal(
    swapProviderInPath("/claude/tips/setup", "gemini"),
    "/gemini/tips",
  );
  assert.equal(
    swapProviderInPath("/claude/guides/setup", "claude"),
    "/claude/guides/setup",
  );
  assert.equal(swapProviderInPath("/", "openai"), "/openai");
});
test("CLI duplicates become one useful update with every source and a real publication date", () => {
  const rows = [
    event({ publishedAt: null, detectedAt: new Date("2026-09-11T12:00:00Z") }),
    event({
      id: 2,
      source: "github_releases_claude_code",
      url: "https://example.com/release",
      bodyMd: "**Useful change** with details.",
    }),
  ];
  const result = buildActivity(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].sources.length, 2);
  assert.equal(result[0].title, "Claude Code 2.1.0");
  assert.equal(result[0].timestamp, date.toISOString());
  assert.equal(result[0].published, true);
  assert.equal(result[0].summary, "Useful change with details.");
  assert.equal(rows[0].title, "v2.1.0");
});
test("distinct providers, SDKs, and prereleases do not collapse into one CLI release", () => {
  const rows = [
    event({}),
    event({ id: 2, provider: "openai", source: "openai_codex_npm" }),
    event({ id: 3, source: "github_releases_sdk_python" }),
    event({ id: 4, title: "v2.1.0-alpha.1", externalId: "2.1.0-alpha.1" }),
  ];
  const result = buildActivity(rows);
  assert.equal(result.length, 4);
  assert.equal(filterActivity(result, "all", "all", "", false).length, 3);
  assert.equal(filterActivity(result, "all", "all", "alpha", true).length, 1);
});
test("feed filters combine provider/category/search and treat no matches as filtered results", () => {
  const items = buildActivity([
    event({}),
    event({
      id: 2,
      provider: "gemini",
      source: "gemini_models",
      title: "A new catalog",
      externalId: "catalog-1",
      publishedAt: null,
    }),
  ]);
  assert.equal(
    filterActivity(items, "gemini", "docs", " NEW catalog ", false).length,
    1,
  );
  assert.equal(filterActivity(items, "gemini", "news", "", true).length, 0);
  assert.equal(items.find((i) => i.provider === "gemini")?.published, false);
});
test("default product updates keep status activity available in its own filter", () => {
  const items = buildActivity([
    event({}),
    event({ id: 2, source: "anthropic_status", title: "Historical incident" }),
  ]);
  assert.equal(filterActivity(items, "all", "changes", "", false).length, 1);
  assert.equal(filterActivity(items, "all", "status", "", false).length, 1);
  assert.equal(filterActivity(items, "all", "all", "", false).length, 2);
});
test("older published events stay behind newly published events even when ingested today", () => {
  const items = buildActivity([
    event({
      source: "anthropic_news",
      title: "Older",
      publishedAt: new Date("2020-01-01"),
      detectedAt: new Date("2026-09-11"),
    }),
    event({
      id: 2,
      source: "anthropic_news",
      title: "Newer",
      publishedAt: date,
    }),
  ]);
  assert.equal(items[0].title, "Newer");
});
test("model search and capability selection use documented true values only", () => {
  const rows = [
    model({
      id: "a",
      displayName: "Alpha",
      capabilities: { vision: true, toolUse: false, newCapability: true },
    }),
    model({ id: "b", displayName: "Beta", capabilities: null }),
  ];
  assert.deepEqual(capabilityOptions(rows), ["newCapability", "vision"]);
  assert.deepEqual(
    selectModels(rows, " ALPHA Vision ", "vision", "name").map((m) => m.id),
    ["a"],
  );
  assert.equal(selectModels(rows, "", "toolUse", "newest").length, 0);
  assert.equal(selectModels(rows, "new capability", null, "name").length, 1);
});
test("model ordering is numeric, deterministic and leaves missing context last without mutating input", () => {
  const rows = [
    model({ id: "unknown", displayName: "Unknown" }),
    model({ id: "small", displayName: "Small", contextWindow: 200_000 }),
    model({
      id: "big",
      displayName: "Big",
      contextWindow: 1_048_576,
      firstSeenAt: new Date("2026-09-10"),
    }),
  ];
  assert.deepEqual(
    selectModels(rows, "", null, "context").map((m) => m.id),
    ["big", "small", "unknown"],
  );
  assert.equal(selectModels(rows, "", null, "newest")[0].id, "big");
  assert.deepEqual(
    rows.map((m) => m.id),
    ["unknown", "small", "big"],
  );
  assert.equal(formatContext(1_048_576), "1,048,576 tokens");
  assert.equal(formatContext(null), "Not reported");
});
