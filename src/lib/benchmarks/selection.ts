// Which models a comparison shows. The selection lives in the URL so it can be
// bookmarked and shared, and the server renders exactly what the URL names.

import type { Provider } from "@/lib/providers";

export const MAX_COMPARED = 4;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,99}$/;

export interface SelectableModel { id: string; name: string; provider: Provider; firstSeenAt?: string }

/** IDs asked for in `?models=`, in order, without duplicates or malformed entries. */
export function requestedIds(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(",").filter((id) => MODEL_ID.test(id)))].slice(0, MAX_COMPARED);
}

/** Canonical link for a selection. An empty selection is the bare page. */
export function compareHref(ids: readonly string[]): string {
  const valid = requestedIds(ids.join(","));
  return valid.length ? `/compare?models=${valid.join(",")}` : "/compare?models=";
}

/**
 * Models launched alongside this one: same lab, same family and version (the ID
 * without its last part, so `gpt-6.2-astra` and `gpt-6.2-sol`), first tracked
 * on the same day.
 */
export function launchSiblings<T extends SelectableModel>(model: SelectableModel, all: readonly T[], limit = 3): T[] {
  const stem = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf("-")));
  const day = model.firstSeenAt?.slice(0, 10);
  if (!day || !stem(model.id)) return [];
  return all.filter((other) => other.id !== model.id && other.provider === model.provider && stem(other.id) === stem(model.id) && other.firstSeenAt?.slice(0, 10) === day).slice(0, limit);
}
