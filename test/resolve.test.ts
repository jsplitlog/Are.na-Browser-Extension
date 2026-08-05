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
      channels: [{ id: 7, slug: 'references', title: 'References', ownerSlug: 'owner', ownerName: 'Owner', status: 'public', webUrl: 'https://www.are.na/owner/references' }],
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
});
