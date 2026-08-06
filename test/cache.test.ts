import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache, getCached, putCached } from '../src/core/cache';
import type { LookupResult } from '../src/core/types';

const values: Record<string, unknown> = {};
let fullScans = 0;
const get = async (keys?: string | string[] | null) => {
  if (keys === null || keys === undefined) {
    fullScans += 1;
    return { ...values };
  }
  const list = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(list.filter((key) => key in values).map((key) => [key, values[key]]));
};
const bytesOf = (key: string) =>
  new TextEncoder().encode(key).byteLength + new TextEncoder().encode(JSON.stringify(values[key])).byteLength;
const getBytesInUse = async (keys?: string | string[] | null) => {
  const list = keys === null || keys === undefined ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
  return list.filter((key) => key in values).reduce((total, key) => total + bytesOf(key), 0);
};
const entryKeys = () => Object.keys(values).filter((key) => key.startsWith('arena-cache:v4:'));

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  fullScans = 0;
  (globalThis as { chrome: unknown }).chrome = {
    storage: { local: { get, getBytesInUse, set: async (items: Record<string, unknown>) => Object.assign(values, items), remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; } } },
  };
});

const result = (status: LookupResult['status'], fetchedAt = Date.now()): LookupResult => ({ normalizedUrl: 'example.com/a', status, blocks: [], fetchedAt });

describe('cache', () => {
  it('caches hits for seven days and misses for one', async () => {
    await putCached(result('hit', Date.now() - 6 * 24 * 60 * 60 * 1000));
    expect(await getCached('example.com/a')).not.toBeNull();
    await putCached(result('miss', Date.now() - 25 * 60 * 60 * 1000));
    expect(await getCached('example.com/a')).toBeNull();
  });

  it('never caches error or auth states', async () => {
    await putCached(result('error'));
    await putCached(result('unauthenticated'));
    expect(await getCached('example.com/a')).toBeNull();
  });

  it('clears only extension cache keys', async () => {
    await putCached(result('hit'));
    values.token = 'keep';
    await clearCache();
    expect(values.token).toBe('keep');
    expect(Object.keys(values).some((key) => key.startsWith('arena-cache:'))).toBe(false);
  });

  it('invalidates cache entries created by the previous resolver', async () => {
    values['arena-cache:v3:example.com/a'] = {
      result: result('miss'),
      accessedAt: Date.now(),
    };

    expect(await getCached('example.com/a')).toBeNull();
    expect(values['arena-cache:v3:example.com/a']).toBeUndefined();
  });

  it('evicts the least-recently-used entry at the 2000-entry cap', async () => {
    const now = Date.now();
    for (let index = 0; index < 2000; index += 1) {
      values[`arena-cache:v4:example.com/${index}`] = {
        result: { normalizedUrl: `example.com/${index}`, status: 'hit', blocks: [], fetchedAt: now },
        accessedAt: index,
      };
    }
    await putCached({ normalizedUrl: 'example.com/new', status: 'hit', blocks: [], fetchedAt: now });
    expect(values['arena-cache:v4:example.com/0']).toBeUndefined();
    expect(values['arena-cache:v4:example.com/new']).toBeDefined();
    expect(entryKeys()).toHaveLength(2000);
  });

  it('still evicts at the entry cap once the tracked entry count is warm', async () => {
    const now = Date.now();
    for (let index = 0; index < 2000; index += 1) {
      values[`arena-cache:v4:example.com/${index}`] = {
        result: { normalizedUrl: `example.com/${index}`, status: 'hit', blocks: [], fetchedAt: now },
        accessedAt: index,
      };
    }
    values['arena-cache:count:v4'] = { count: 2000 };

    await putCached(result('hit', now));

    expect(values['arena-cache:v4:example.com/0']).toBeUndefined();
    expect(values['arena-cache:v4:example.com/a']).toBeDefined();
    expect(entryKeys()).toHaveLength(2000);
  });

  it('writes without rescanning the whole cache while it is far from its limits', async () => {
    await putCached(result('hit'));
    expect(fullScans).toBe(1);

    await putCached({ normalizedUrl: 'example.com/b', status: 'hit', blocks: [], fetchedAt: Date.now() });
    await putCached(result('miss'));

    expect(fullScans).toBe(1);
    expect(entryKeys()).toHaveLength(2);
  });

  it('evicts old entries before Chrome local-storage byte quota is approached', async () => {
    const now = Date.now();
    const largeTitle = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 8; index += 1) {
      values[`arena-cache:v4:example.com/${index}`] = {
        result: {
          normalizedUrl: `example.com/${index}`,
          status: 'hit',
          blocks: [{ createdAt: null, title: largeTitle }],
          fetchedAt: now,
        },
        accessedAt: index,
      };
    }

    await putCached(result('hit', now));

    expect(values['arena-cache:v4:example.com/0']).toBeUndefined();
    expect(values['arena-cache:v4:example.com/a']).toBeDefined();
  });
});
