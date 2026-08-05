const KEY = 'arena-settings:lookup-counts';
export interface LookupCounts { lookups: number; hits: number }

export const getLookupCounts = async (): Promise<LookupCounts> => {
  const value = (await chrome.storage.local.get(KEY))[KEY];
  if (!value || typeof value !== 'object') return { lookups: 0, hits: 0 };
  const counts = value as Partial<LookupCounts>;
  return { lookups: typeof counts.lookups === 'number' ? counts.lookups : 0, hits: typeof counts.hits === 'number' ? counts.hits : 0 };
};

/** Metrics stay in extension-local storage and are never included in API requests. */
let pendingRecord: Promise<void> = Promise.resolve();

export const recordLookup = (hit: boolean): Promise<void> => {
  const update = pendingRecord.then(async () => {
    const counts = await getLookupCounts();
    await chrome.storage.local.set({ [KEY]: { lookups: counts.lookups + 1, hits: counts.hits + (hit ? 1 : 0) } });
  });
  // A failed write must not permanently poison later metric updates.
  pendingRecord = update.catch(() => undefined);
  return update;
};
