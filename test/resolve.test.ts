import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaBlock, LookupResult } from '../src/core/types';

const mocks = vi.hoisted(() => {
  class ArenaError extends Error {
    constructor(public readonly kind: string) { super(kind); }
  }
  return {
    ArenaError,
    getToken: vi.fn<() => Promise<string | null>>(),
    searchBlocks: vi.fn(),
    getBlockConnections: vi.fn(),
    getCached: vi.fn(),
    putCached: vi.fn(),
    recordLookup: vi.fn(),
  };
});

vi.mock('../src/core/auth', () => ({ getToken: mocks.getToken }));
vi.mock('../src/core/arena', () => ({
  ArenaError: mocks.ArenaError,
  createRequestBudget: (remaining = 10) => ({ remaining }),
  searchBlocks: mocks.searchBlocks,
  getBlockConnections: mocks.getBlockConnections,
}));
vi.mock('../src/core/cache', () => ({ getCached: mocks.getCached, putCached: mocks.putCached }));
vi.mock('../src/core/settings', () => ({ recordLookup: mocks.recordLookup }));

import { blocksFor, connectionsFor } from '../src/core/resolve';

const block: ArenaBlock = {
  id: 42,
  title: 'Example',
  sourceUrl: 'https://example.com/an-article-about-design',
  imageUrl: null,
  blockType: 'Link',
  userName: null,
  userSlug: null,
  userAvatarUrl: null,
  createdAt: '2026-08-05T12:00:00Z',
  connectionCount: 1,
};

describe('two-phase resolver integration', () => {
  let cached: LookupResult | null;

  beforeEach(() => {
    cached = null;
    vi.clearAllMocks();
    mocks.getToken.mockResolvedValue('token');
    mocks.getCached.mockImplementation(async () => cached);
    mocks.putCached.mockImplementation(async (result: LookupResult) => { cached = result; });
    mocks.searchBlocks.mockResolvedValue([block]);
    mocks.getBlockConnections.mockResolvedValue({
      channels: [{ id: 7, slug: 'references', title: 'References', ownerSlug: 'owner', ownerName: 'Owner', visibility: 'public', webUrl: 'https://www.are.na/owner/references' }],
      total: 1,
    });
  });

  it('serves a second complete lookup from cache without API calls', async () => {
    const firstBlocks = await blocksFor('https://example.com/an-article-about-design');
    const firstComplete = await connectionsFor(firstBlocks);
    expect(firstComplete.connections?.[42]).toHaveLength(1);

    const secondBlocks = await blocksFor('https://example.com/an-article-about-design');
    const secondComplete = await connectionsFor(secondBlocks);
    expect(secondComplete.connections?.[42]).toHaveLength(1);
    expect(mocks.searchBlocks).toHaveBeenCalledOnce();
    expect(mocks.getBlockConnections).toHaveBeenCalledOnce();
  });

  it('searches low-word-count public domains instead of skipping them', async () => {
    mocks.searchBlocks.mockResolvedValueOnce([]);

    await expect(blocksFor('https://x.com/')).resolves.toMatchObject({ status: 'miss' });
    expect(mocks.searchBlocks).toHaveBeenCalledWith('https://x.com/', expect.anything());
  });

  it('surfaces a persistent rate limit distinctly and never caches it', async () => {
    mocks.searchBlocks.mockRejectedValueOnce(new mocks.ArenaError('rate_limited'));

    await expect(blocksFor('https://example.com/an-article')).resolves.toMatchObject({
      status: 'rate_limited',
      normalizedUrl: 'example.com/an-article',
    });
    expect(mocks.putCached).not.toHaveBeenCalled();
  });

  it('normalizes the URL on the unauthenticated and skipped early returns', async () => {
    mocks.getToken.mockResolvedValue(null);
    await expect(blocksFor('https://www.example.com/an-article/')).resolves.toMatchObject({
      status: 'unauthenticated',
      normalizedUrl: 'example.com/an-article',
    });

    mocks.getToken.mockResolvedValue('token');
    await expect(blocksFor('http://localhost:3000/dev/')).resolves.toMatchObject({
      status: 'skipped',
      normalizedUrl: 'localhost/dev',
    });
    await expect(blocksFor('not a URL')).resolves.toMatchObject({
      status: 'skipped',
      normalizedUrl: 'not a URL',
    });
  });

  it('fills every missing originating channel in a partial cached result', async () => {
    const blocks = Array.from({ length: 12 }, (_, index) => ({ ...block, id: index + 1 }));
    const original = {
      id: 100,
      slug: 'already-cached',
      title: 'Already cached',
      ownerSlug: 'owner',
      ownerName: 'Owner',
      visibility: 'public',
      webUrl: 'https://www.are.na/owner/already-cached',
    };
    const partial: LookupResult = {
      normalizedUrl: 'example.com/an-article-about-design',
      status: 'hit',
      blocks,
      fetchedAt: Date.now(),
      connections: { 1: [original] },
    };

    const complete = await connectionsFor(partial);

    expect(mocks.getBlockConnections).toHaveBeenCalledTimes(11);
    expect(mocks.getBlockConnections).not.toHaveBeenCalledWith(1, expect.anything());
    expect(Object.keys(complete.connections ?? {})).toHaveLength(12);
    expect(complete.connections?.[1]).toEqual([original]);
  });

  it('keeps a valid block result when one channel enrichment fails', async () => {
    const blocks = Array.from({ length: 3 }, (_, index) => ({ ...block, id: index + 1 }));
    const result: LookupResult = {
      normalizedUrl: 'example.com/an-article-about-design',
      status: 'hit',
      blocks,
      fetchedAt: Date.now(),
    };
    mocks.getBlockConnections.mockImplementation(async (id: number) => {
      if (id === 2) throw new mocks.ArenaError('network');
      return {
        channels: [{ id: id + 100, slug: `channel-${id}`, title: `Channel ${id}` }],
        total: id,
      };
    });

    const partial = await connectionsFor(result);

    expect(partial.status).toBe('hit');
    expect(Object.keys(partial.connections ?? {})).toEqual(['1', '3']);

    mocks.getBlockConnections.mockResolvedValue({ channels: [], total: 2 });
    const complete = await connectionsFor(partial);

    expect(mocks.getBlockConnections).toHaveBeenLastCalledWith(2, expect.anything());
    expect(Object.keys(complete.connections ?? {})).toEqual(['1', '2', '3']);
  });
});
