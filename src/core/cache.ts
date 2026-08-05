import type { LookupResult } from './types';

const PREFIX = 'arena-cache:';
const HIT_TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
// chrome.storage.local is limited to 10 MB without unlimitedStorage. Keep a
// margin for credentials and settings instead of relying on entry count alone.
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

interface CacheEntry { result: LookupResult; accessedAt: number }
const keyFor = (normalizedUrl: string) => `${PREFIX}${normalizedUrl}`;
const storage = () => chrome.storage.local;
const storedBytes = (key: string, value: unknown): number =>
  new TextEncoder().encode(key).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
const isEntry = (value: unknown): value is CacheEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry>;
  return !!entry.result && typeof entry.accessedAt === 'number' &&
    typeof entry.result.fetchedAt === 'number' && Array.isArray(entry.result.blocks) &&
    entry.result.blocks.every((block) => !!block && typeof block === 'object' && 'createdAt' in block);
};

export const getCached = async (normalizedUrl: string): Promise<LookupResult | null> => {
  const key = keyFor(normalizedUrl);
  const value = (await storage().get(key))[key];
  if (!isEntry(value)) return null;
  const ttl = value.result.status === 'hit' ? HIT_TTL : value.result.status === 'miss' ? MISS_TTL : 0;
  if (!ttl || Date.now() - value.result.fetchedAt > ttl) {
    await storage().remove(key);
    return null;
  }
  await storage().set({ [key]: { ...value, accessedAt: Date.now() } satisfies CacheEntry });
  return value.result;
};

export const putCached = async (result: LookupResult): Promise<void> => {
  if (result.status !== 'hit' && result.status !== 'miss') return;
  const all = await storage().get(null);
  const key = keyFor(result.normalizedUrl);
  const entry = { result, accessedAt: Date.now() } satisfies CacheEntry;
  const invalidKeys: string[] = [];
  const entries: Array<[string, CacheEntry]> = [];
  for (const [storedKey, value] of Object.entries(all)) {
    if (!storedKey.startsWith(PREFIX) || storedKey === key) continue;
    if (isEntry(value)) entries.push([storedKey, value]);
    else invalidKeys.push(storedKey);
  }

  entries.sort((a, b) => a[1].accessedAt - b[1].accessedAt);
  let cacheBytes = storedBytes(key, entry) + entries.reduce(
    (total, [storedKey, value]) => total + storedBytes(storedKey, value),
    0,
  );
  const keysToRemove = [...invalidKeys];
  while (entries.length + 1 > MAX_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    cacheBytes -= storedBytes(oldest[0], oldest[1]);
    keysToRemove.push(oldest[0]);
  }
  if (keysToRemove.length) await storage().remove(keysToRemove);
  await storage().set({ [key]: entry });
};

/** Removes only this extension's lookup cache, leaving auth and preferences intact. */
export const clearCache = async (): Promise<void> => {
  const all = await storage().get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
  if (keys.length) await storage().remove(keys);
};
