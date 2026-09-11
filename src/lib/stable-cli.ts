/** The shared reader can fall back to a prerelease; a stable-only UI must not. */
export function stableCliVersion(observed: string | null): string | null {
  return observed && /^v?\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(observed)
    ? observed.replace(/^v/, "")
    : null;
}
