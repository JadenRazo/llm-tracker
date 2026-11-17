// Match a publisher's model label to a tracked model, exactly or not at all.
//
// Publishers spell the same model differently (`gpt-6.2-astra`,
// `gpt-6-2-astra`, "GPT-6.2 Astra"), so labels are compared on their letters
// and digits only. That is the whole of the leniency: there is no prefix,
// fuzzy or version-family matching, so "GPT-6 Astra" can never be read as
// GPT-6.2 Astra, and a label that could mean two tracked models means neither.

export const canonicalModelKey = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface TrackedModel { id: string; name: string }

export function modelMatcher(tracked: readonly TrackedModel[]): (label: string) => string | null {
  const byKey = new Map<string, string | null>();
  const claim = (key: string, id: string) => {
    if (!key) return;
    const held = byKey.get(key);
    if (held === undefined) byKey.set(key, id);
    else if (held !== id) byKey.set(key, null); // two tracked models share this spelling: ambiguous
  };
  // IDs first: a display name may never take a key that another model's ID owns.
  for (const model of tracked) claim(canonicalModelKey(model.id), model.id);
  for (const model of tracked) {
    const key = canonicalModelKey(model.name);
    if (!byKey.has(key)) claim(key, model.id);
    else if (byKey.get(key) !== model.id && !tracked.some((other) => canonicalModelKey(other.id) === key)) byKey.set(key, null);
  }
  return (label) => byKey.get(canonicalModelKey(label)) ?? null;
}
