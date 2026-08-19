// Distinguish "there is genuinely no data" from "we could not read the data".
//
// Every page loader used to `catch { return []; }`, so a database outage
// rendered the same calm "Nothing has been ingested from any Claude source so
// far" as a truly empty table. That is a confident falsehood at exactly the
// moment a reader most needs the truth — and it is how a broken site looked
// merely new.

/** `rows` on success; `null` when the read failed or no DB handle exists. */
export type LoadResult<T> = T[] | null;

/** True when the read itself failed (as opposed to succeeding with zero rows). */
export function isUnavailable<T>(result: LoadResult<T>): result is null {
  return result === null;
}

/** Rows to render — empty when unavailable, so callers can map without a guard. */
export function rowsOf<T>(result: LoadResult<T>): T[] {
  return result ?? [];
}
