// Everything the comparison and model pages need, resolved once per request.

import { cache } from "react";
import { getFrontierData } from "@/lib/frontier/read";
import { LABS, readModelDirectory, type DirectoryEntry } from "@/lib/model-directory";
import { comparison, coverage, resultsByModel, type ComparedModel } from "./compare";
import { getBenchmarkData } from "./read";
import { DEFAULT_BENCHMARKS } from "./registry";
import { requestedIds } from "./selection";
import type { PickerOption } from "@/components/benchmarks/model-picker";

const getDirectory = cache(() => readModelDirectory());

/**
 * Every model the tracker knows: the catalog, plus any profiled model the
 * catalog does not hold (a pick is verified from its own documents, and a
 * bundled fallback may be showing while the database is away).
 */
export const getTrackedModels = cache(async () => {
  const [directory, frontier, benchmarks] = await Promise.all([getDirectory(), getFrontierData(""), getBenchmarkData()]);
  const tracked = new Map<string, DirectoryEntry>();
  for (const entry of directory ?? []) tracked.set(entry.id, entry);
  for (const model of frontier.current) if (!tracked.has(model.id)) tracked.set(model.id, { id: model.id, name: model.name, provider: model.provider, firstSeenAt: model.verifiedAt ?? "" });
  const models = [...tracked.values()];
  const byModel = resultsByModel(benchmarks.rows, models);
  const picks = new Set(frontier.current.map((m) => m.id));
  const options: PickerOption[] = models.map((m) => ({ id: m.id, name: m.name, provider: m.provider, lab: LABS[m.provider], coverage: coverage(m.id, byModel), pick: picks.has(m.id) }));
  return { models, byModel, options, frontier, benchmarks, directoryUnavailable: directory === null };
});

export async function loadComparison(raw: string | undefined) {
  const tracked = await getTrackedModels();
  // No parameter: the current pick from each lab. An empty parameter: nothing selected.
  const asked = raw === undefined ? tracked.frontier.current.map((m) => m.id) : requestedIds(raw);
  const selected: ComparedModel[] = asked.flatMap((id) => { const model = tracked.models.find((m) => m.id === id); return model ? [{ id: model.id, name: model.name, provider: model.provider }] : []; });
  const unresolved = asked.filter((id) => !selected.some((m) => m.id === id));
  return { ...tracked, selected, unresolved, table: comparison(selected, tracked.byModel), defaultCount: DEFAULT_BENCHMARKS.length };
}
