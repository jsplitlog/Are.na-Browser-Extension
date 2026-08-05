import { beforeEach, describe, expect, it } from 'vitest';

const values: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  (globalThis as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          await Promise.resolve();
          return key in values ? { [key]: values[key] } : {};
        },
        set: async (items: Record<string, unknown>) => {
          await Promise.resolve();
          Object.assign(values, items);
        },
      },
    },
  };
});

describe('lookup metrics', () => {
  it('does not lose simultaneous lookup updates', async () => {
    const { getLookupCounts, recordLookup } = await import('../src/core/settings');

    await Promise.all([recordLookup(true), recordLookup(false), recordLookup(true)]);

    await expect(getLookupCounts()).resolves.toEqual({ lookups: 3, hits: 2 });
  });
});
