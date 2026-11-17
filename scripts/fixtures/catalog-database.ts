// A recording stand-in for the Drizzle client, for the catalog adapters. Every
// builder chain is awaitable; selects answer from a queue so a test can script
// "existing model ids" and "rows still needing enrichment" in order.
export const state = {
  selects: [] as unknown[][],
  operations: [] as { kind: "insert" | "update" | "delete"; values?: unknown }[],
};
export function resetDatabase(selects: unknown[][] = []) {
  state.selects = selects;
  state.operations = [];
}
function chain(result: () => unknown): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, property) {
      if (property === "then") return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => { try { resolve(result()); } catch (error) { reject(error); } };
      return () => proxy;
    },
  });
  return proxy;
}
export function env() { return {}; }
export function tryGetDb() {
  return {
    // Validator lookups (poller_runs) and model lookups share the queue; an empty queue answers [].
    select: () => chain(() => state.selects.shift() ?? []),
    insert: () => ({ values: (values: unknown) => { state.operations.push({ kind: "insert", values }); return chain(() => []); } }),
    update: () => { state.operations.push({ kind: "update" }); return chain(() => []); },
    delete: () => { state.operations.push({ kind: "delete" }); return chain(() => []); },
  };
}
export const getDb = tryGetDb;
export type Database = ReturnType<typeof tryGetDb>;
