export const state = {
  persistedEtag: undefined as string | undefined,
  writeFailure: false,
  writes: [] as Record<string, unknown>[][],
  stored: new Set<string>(),
};
export function resetDatabase() {
  state.persistedEtag = undefined;
  state.writeFailure = false;
  state.writes = [];
  state.stored.clear();
}
export function env() { return { GITHUB_TOKEN: undefined }; }
export function tryGetDb() {
  return {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.persistedEtag ? [{ etag: state.persistedEtag }] : [] }) }) }) }),
    insert: () => ({ values: (rows: Record<string, unknown>[]) => ({ onConflictDoNothing: () => ({ returning: async () => {
      if (state.writeFailure) throw new Error('fixture write failure');
      state.writes.push(rows);
      const inserted: { id: number }[] = [];
      for (const row of rows) {
        const key = String(row.externalId);
        if (!state.stored.has(key)) { state.stored.add(key); inserted.push({ id: state.stored.size }); }
      }
      return inserted;
    } }) }) }),
  };
}
