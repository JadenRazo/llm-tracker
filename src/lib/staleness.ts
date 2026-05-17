// Staleness comparison for curated content. Pure module — no DB imports, no
// framework imports. Given a frontmatter entry + the current Claude Code CLI
// version, returns a StalenessResult the UI can render as a badge.
//
// Fail-open: if the author didn't annotate verifiedAgainstCli/verifiedAt, or
// if we haven't detected a current CLI version yet, returns status "unknown"
// and the caller renders nothing. We never surface a false-positive stale
// warning on content that was never annotated.

import type { ContentFrontmatter } from "@/lib/content";

export type StalenessStatus = "unknown" | "fresh" | "stale";
export type StalenessReason = "version" | "age" | "both";

export interface StalenessResult {
  status: StalenessStatus;
  reason?: StalenessReason;
  verifiedAgainstCli?: string;
  verifiedAt?: string;
  currentCliVersion?: string;
}

const STALE_AGE_DAYS = 60;

function parseSemver(v: string): [number, number, number] | null {
  // Strip a `v` prefix and any `-pre.1`-style suffix before comparing numerics.
  const cleaned = v.trim().replace(/^v/, "").split(/[-+]/)[0] ?? "";
  const parts = cleaned.split(".");
  const [maj, min, patch] = [parts[0] ?? "0", parts[1] ?? "0", parts[2] ?? "0"];
  const a = Number.parseInt(maj, 10);
  const b = Number.parseInt(min, 10);
  const c = Number.parseInt(patch, 10);
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return null;
  return [a, b, c];
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

/**
 * True when `current` is meaningfully ahead of `verified`:
 *   - A higher major, or
 *   - Same major but minor gap of 2 or more.
 * Patch-level differences never register as "stale".
 */
export function isMoreThanOneMinorBehind(verified: string, current: string): boolean {
  const v = parseSemver(verified);
  const c = parseSemver(current);
  if (!v || !c) return false;
  if (c[0] > v[0]) return true;
  if (c[0] === v[0] && c[1] - v[1] >= 2) return true;
  return false;
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function computeStaleness(
  fm: Pick<ContentFrontmatter, "verifiedAgainstCli" | "verifiedAt">,
  currentCliVersion: string | null,
  now: Date = new Date(),
): StalenessResult {
  const verifiedAgainstCli = fm.verifiedAgainstCli;
  const verifiedAt = fm.verifiedAt;

  // Fail-open: unannotated content, or no current CLI signal yet.
  if (!verifiedAgainstCli || !verifiedAt || !currentCliVersion) {
    return { status: "unknown" };
  }

  const versionBehind = isMoreThanOneMinorBehind(verifiedAgainstCli, currentCliVersion);

  let tooOld = false;
  const parsed = new Date(verifiedAt);
  if (!Number.isNaN(parsed.getTime())) {
    tooOld = daysBetween(parsed, now) > STALE_AGE_DAYS;
  }

  if (versionBehind && tooOld) {
    return { status: "stale", reason: "both", verifiedAgainstCli, verifiedAt, currentCliVersion };
  }
  if (versionBehind) {
    return { status: "stale", reason: "version", verifiedAgainstCli, verifiedAt, currentCliVersion };
  }
  if (tooOld) {
    return { status: "stale", reason: "age", verifiedAgainstCli, verifiedAt, currentCliVersion };
  }

  return { status: "fresh", verifiedAgainstCli, verifiedAt, currentCliVersion };
}
