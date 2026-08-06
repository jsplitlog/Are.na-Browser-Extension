import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getToken, signOut, normalizeUrl, buildQueries } = vi.hoisted(() => ({
  getToken: vi.fn<() => Promise<string | null>>(),
  signOut: vi.fn<() => Promise<void>>(),
  normalizeUrl: vi.fn((url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')),
  buildQueries: vi.fn(() => ['specific query', 'fallback query', 'ignored']),
}));
vi.mock('../src/core/auth', () => ({ getToken, signOut }));
vi.mock('../src/core/url', () => ({ normalizeUrl, buildQueries }));

import { ArenaError, createRequestBudget, getBlockConnections, searchBlocks } from '../src/core/arena';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.restoreAllMocks();
  getToken.mockResolvedValue('token');
  normalizeUrl.mockImplementation((url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
  buildQueries.mockReturnValue(['specific query', 'fallback query', 'ignored']);
});

describe('arena API', () => {
  it('uses two token queries and retains only exact normalized URL matches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: 1, title: 'yes', class: 'Link', created_at: '2026-08-05T12:00:00Z', source: { url: 'https://example.com/a/' }, user: { name: 'Creator', slug: 'creator', avatar: 'https://static.avatars.are.na/creator.jpg' } }, { id: 2, source: { url: 'https://other.test/a' } }] }))
      .mockResolvedValueOnce(json({ data: [{ id: 1, source: { url: 'https://example.com/a/' } }, { id: 3, class: 'Embed', source: { url: 'https://example.com/a' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const blocks = await searchBlocks('https://www.example.com/a/');
    expect(blocks.map((block) => block.id)).toEqual([1, 3]);
    expect(blocks[0]).toMatchObject({ userName: 'Creator', userSlug: 'creator', userAvatarUrl: 'https://static.avatars.are.na/creator.jpg', createdAt: '2026-08-05T12:00:00Z' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('type=Link%2CEmbed%2CImage');
  });

  it('ignores malformed source URLs without discarding valid matches', async () => {
    normalizeUrl.mockImplementation((url) => {
      if (url === 'not a valid URL') throw new TypeError('Invalid URL');
      return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    });
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [
      { id: 1, source: { url: 'not a valid URL' } },
      { id: 2, source: { url: 'https://example.com/a' } },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    buildQueries.mockReturnValueOnce(['specific query']);

    await expect(searchBlocks('https://example.com/a')).resolves.toEqual([
      expect.objectContaining({ id: 2 }),
    ]);
  });

  it('maps premium and authentication errors distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 402)));
    await expect(searchBlocks('https://example.com/a')).rejects.toMatchObject({ kind: 'not_premium' } satisfies Partial<ArenaError>);
    getToken.mockResolvedValue(null);
    await expect(searchBlocks('https://example.com/a')).rejects.toMatchObject({ kind: 'unauthenticated' } satisfies Partial<ArenaError>);
  });

  it('clears rejected credentials on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
    await expect(searchBlocks('https://example.com/an-article')).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('retries 5xx once and respects a request budget', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    buildQueries.mockReturnValueOnce(['specific query']);
    await searchBlocks('https://example.com/a', createRequestBudget(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(searchBlocks('https://example.com/a', createRequestBudget(0))).rejects.toMatchObject({ kind: 'network' } satisfies Partial<ArenaError>);
  });

  it.each([403, 408, 429])('retries and surfaces HTTP %s as an error, never a miss', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, status));
    vi.stubGlobal('fetch', fetchMock);
    buildQueries.mockReturnValueOnce(['specific query']);
    await expect(searchBlocks('https://example.com/an-article')).rejects.toMatchObject({
      kind: status === 429 ? 'rate_limited' : 'network',
      status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests only the oldest connection and preserves the total connection count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [
      { id: 9, slug: 'original', title: 'Original', visibility: 'public', status: 'closed', owner: { slug: 'owner-one', full_name: 'One' }, user: { slug: 'wrong' } },
    ], meta: { total_count: 14 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getBlockConnections(42)).resolves.toEqual({ channels: [
      expect.objectContaining({ slug: 'original', ownerSlug: 'owner-one', visibility: 'public', webUrl: 'https://www.are.na/owner-one/original' }),
    ], total: 14 });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe('/v3/blocks/42/connections');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ per: '1', sort: 'created_at_asc' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    });
  });

  it('falls back to the returned original channel when connection count metadata is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [
      { id: 9, slug: 'original', owner: { slug: 'owner-one' } },
    ] })));

    await expect(getBlockConnections(42)).resolves.toMatchObject({ total: 1 });
  });

  it('uses legacy total metadata while discarding malformed connection data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      data: [{ id: 'not-a-number', slug: 'broken' }],
      meta: { total: 6 },
    })));

    await expect(getBlockConnections(42)).resolves.toEqual({ channels: [], total: 6 });
  });

  it('returns a safe empty result for a malformed connections response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: 'not-an-array', meta: { total_count: 'many' } })));

    await expect(getBlockConnections(42)).resolves.toEqual({ channels: [], total: 0 });
  });
});
