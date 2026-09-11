import type { Model } from "@/lib/db/schema";

export type ModelSort = "newest" | "name" | "context";

const LABELS = new Map<string, string>([
  ["toolUse", "Tool use"],
  ["vision", "Vision"],
  ["extendedThinking", "Extended thinking"],
  ["adaptiveThinking", "Adaptive thinking"],
  ["thinking", "Thinking"],
  ["pdfs", "PDFs"],
  ["functionCalling", "Function calling"],
  ["structuredOutputs", "Structured outputs"],
  ["codeExecution", "Code execution"],
  ["imageGeneration", "Image generation"],
  ["audioGeneration", "Audio generation"],
  ["computerUse", "Computer use"],
  ["searchGrounding", "Search grounding"],
  ["groundingWithGoogleMaps", "Maps grounding"],
  ["urlContext", "URL context"],
  ["fileSearch", "File search"],
  ["batchApi", "Batch API"],
  ["liveApi", "Live API"],
  ["flexInference", "Flex inference"],
  ["priorityInference", "Priority inference"],
  ["priorityTier", "Priority tier"],
  ["caching", "Caching"],
  ["reasoning", "Reasoning"],
  ["audioInput", "Audio input"],
  ["fineTuning", "Fine-tuning"],
  ["documented", "Documented"],
]);

export function capabilityLabel(key: string): string {
  const label = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return (
    LABELS.get(key) ??
    (label
      ? label.charAt(0).toUpperCase() + label.slice(1)
      : key || "Unnamed capability")
  );
}

export function trueCapabilities(caps: Model["capabilities"]): string[] {
  return Object.entries(caps ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

export function capabilityOptions(models: readonly Model[]): string[] {
  return [
    ...new Set(models.flatMap((m) => trueCapabilities(m.capabilities))),
  ].sort(
    (a, b) =>
      compareText(capabilityLabel(a), capabilityLabel(b)) || compareText(a, b),
  );
}

function numericValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function newestValue(date: Date | null | undefined): number | null {
  const value = date?.getTime();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function descending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

export function selectModels(
  models: readonly Model[],
  query: string,
  capability: string | null,
  sort: ModelSort,
): Model[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return models
    .filter((model) => {
      const caps = trueCapabilities(model.capabilities);
      if (capability !== null && !caps.includes(capability)) return false;
      const searchable = [
        model.id,
        model.displayName,
        ...caps,
        ...caps.map(capabilityLabel),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .sort((a, b) => {
      const primary =
        sort === "context"
          ? descending(
              numericValue(a.contextWindow),
              numericValue(b.contextWindow),
            )
          : sort === "newest"
            ? descending(newestValue(a.firstSeenAt), newestValue(b.firstSeenAt))
            : 0;
      return (
        primary ||
        compareText(a.displayName, b.displayName) ||
        compareText(a.id, b.id)
      );
    });
}

export function formatContext(value: number | null | undefined): string {
  const valid = numericValue(value);
  return valid === null
    ? "Not reported"
    : `${valid.toLocaleString("en-US")} tokens`;
}

export function formatTrackedDate(
  date: Date | null | undefined,
): string | null {
  return newestValue(date) === null ? null : date!.toISOString().slice(0, 10);
}
