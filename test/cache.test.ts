import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache, getCached, putCached } from '../src/core/cache';
import type { LookupResult } from '../src/core/types';

const values: Record<string, unknown> = {};
const get = async (keys?: string | string[] | null) => {
  if (keys === null || keys === undefined) return { ...values };
  const list = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(list.filter((key) => key in values).map((key) => [key, values[key]]));
};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  (globalThis as { chrome: unknown }).chrome = {
    storage: { local: { get, set: async (items: Record<string, unknown>) => Object.assign(values, items), remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; } } },
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

  it('evicts the least-recently-used entry at the 2000-entry cap', async () => {
    const now = Date.now();
    for (let index = 0; index < 2000; index += 1) {
      values[`arena-cache:example.com/${index}`] = {
        result: { normalizedUrl: `example.com/${index}`, status: 'hit', blocks: [], fetchedAt: now },
        accessedAt: index,
      };
    }
    await putCached({ normalizedUrl: 'example.com/new', status: 'hit', blocks: [], fetchedAt: now });
    expect(values['arena-cache:example.com/0']).toBeUndefined();
    expect(values['arena-cache:example.com/new']).toBeDefined();
    expect(Object.keys(values)).toHaveLength(2000);
  });

  it('evicts old entries before Chrome local-storage byte quota is approached', async () => {
    const now = Date.now();
    const largeTitle = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 8; index += 1) {
      values[`arena-cache:example.com/${index}`] = {
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

    expect(values['arena-cache:example.com/0']).toBeUndefined();
    expect(values['arena-cache:example.com/a']).toBeDefined();
  });
});
