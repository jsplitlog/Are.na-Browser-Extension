import type { LookupResult } from './types';

const CACHE_NAMESPACE = 'arena-cache:';
const PREFIX = `${CACHE_NAMESPACE}v4:`;
const PREVIOUS_PREFIXES = [`${CACHE_NAMESPACE}v3:`, `${CACHE_NAMESPACE}v2:`];
const HIT_TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
// chrome.storage.local is limited to 10 MB without unlimitedStorage. Keep a
// margin for credentials and settings instead of relying on entry count alone.
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
// Entry count is the one limit chrome.storage cannot report cheaply, so it is
// tracked alongside the entries. A missing or stale count only costs a rescan.
const COUNT_KEY = `${CACHE_NAMESPACE}count:v4`;

interface CacheEntry { result: LookupResult; accessedAt: number }
const keyFor = (normalizedUrl: string) => `${PREFIX}${normalizedUrl}`;
const legacyKeyFor = (normalizedUrl: string) => `${CACHE_NAMESPACE}${normalizedUrl}`;
const previousKeysFor = (normalizedUrl: string) => PREVIOUS_PREFIXES.map((prefix) => `${prefix}${normalizedUrl}`);
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
  const legacyKey = legacyKeyFor(normalizedUrl);
  const previousKeys = previousKeysFor(normalizedUrl);
  const stored = await storage().get([key, legacyKey, ...previousKeys]);
  const obsoleteKeys = [legacyKey, ...previousKeys].filter((obsoleteKey) => obsoleteKey in stored);
  if (obsoleteKeys.length) await storage().remove(obsoleteKeys);
  const value = stored[key];
  if (!isEntry(value)) return null;
  const ttl = value.result.status === 'hit' ? HIT_TTL : value.result.status === 'miss' ? MISS_TTL : 0;
  if (!ttl || Date.now() - value.result.fetchedAt > ttl) {
    await storage().remove(key);
    return null;
  }
  await storage().set({ [key]: { ...value, accessedAt: Date.now() } satisfies CacheEntry });
  return value.result;
};

const storedCount = (value: unknown): number | null => {
  const count = (value as { count?: unknown } | undefined)?.count;
  return typeof count === 'number' && count >= 0 ? count : null;
};

const bytesInUse = async (): Promise<number | null> => {
  try {
    return await storage().getBytesInUse(null);
  } catch {
    return null;
  }
};

/** Full scan: the only path that re-serializes the cache, so it also repairs the count. */
const evictAndSet = async (key: string, entry: CacheEntry): Promise<void> => {
  const all = await storage().get(null);
  const invalidKeys: string[] = [];
  const entries: Array<[string, CacheEntry]> = [];
  for (const [storedKey, value] of Object.entries(all)) {
    if (!storedKey.startsWith(CACHE_NAMESPACE) || storedKey === key || storedKey === COUNT_KEY) continue;
    if (!storedKey.startsWith(PREFIX)) {
      invalidKeys.push(storedKey);
      continue;
    }
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
  await storage().set({ [key]: entry, [COUNT_KEY]: { count: entries.length + 1 } });
};

export const putCached = async (result: LookupResult): Promise<void> => {
  if (result.status !== 'hit' && result.status !== 'miss') return;
  const key = keyFor(result.normalizedUrl);
  const entry = { result, accessedAt: Date.now() } satisfies CacheEntry;
  const known = await storage().get([key, COUNT_KEY]);
  const count = storedCount(known[COUNT_KEY]);
  const nextCount = (count ?? 0) + (key in known ? 0 : 1);
  const bytes = await bytesInUse();
  // A scan re-serializes every cached entry, so only pay for it when the cheap
  // counters say this write could cross a limit.
  if (count === null || bytes === null ||
    nextCount > MAX_ENTRIES || bytes + storedBytes(key, entry) > MAX_CACHE_BYTES) {
    await evictAndSet(key, entry);
    return;
  }
  await storage().set({ [key]: entry, [COUNT_KEY]: { count: nextCount } });
};

/** Removes only this extension's lookup cache, leaving auth and preferences intact. */
export const clearCache = async (): Promise<void> => {
  const all = await storage().get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(CACHE_NAMESPACE));
  if (keys.length) await storage().remove(keys);
};
