import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, unknown>;
const session: Store = {};
const local: Store = {};

const area = (store: Store) => ({
  get: vi.fn(async (keys: string | string[] | null) => {
    if (keys === null) return { ...store };
    const selected = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(selected.filter((key) => key in store).map((key) => [key, store[key]]));
  }),
  set: vi.fn(async (items: Store) => { Object.assign(store, items); }),
  remove: vi.fn(async (keys: string[]) => { keys.forEach((key) => delete store[key]); }),
});

vi.stubGlobal('chrome', {
  storage: { session: area(session), local: area(local) },
  identity: { getRedirectURL: () => 'https://unit-test.chromiumapp.org/', launchWebAuthFlow: vi.fn() },
});

const auth = await import('../src/core/auth');

beforeEach(() => {
  Object.keys(session).forEach((key) => delete session[key]);
  Object.keys(local).forEach((key) => delete local[key]);
  vi.stubGlobal('fetch', vi.fn());
});

describe('auth', () => {
  it('validates /v3/me before saving a session-only token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { slug: 'me', badge: 'Supporter' } }), { status: 200 }));

    await auth.saveToken('  secret-token  ', false);

    expect(fetch).toHaveBeenCalledWith('https://api.are.na/v3/me', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
    expect(await auth.getToken()).toBe('secret-token');
    expect(local.arenaAuthToken).toBeUndefined();
    expect(await auth.getAuthState()).toEqual({ signedIn: true, userSlug: 'me', tier: 'Supporter' });
  });

  it('only writes local storage when remember is selected', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    await auth.saveToken('remembered', true);

    expect(local.arenaAuthToken).toBe('remembered');
    expect(session.arenaAuthToken).toBeUndefined();
  });

  it('does not persist a rejected token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }));

    await expect(auth.saveToken('bad-token', false)).rejects.toMatchObject({ kind: 'invalid_token' });
    expect(await auth.getToken()).toBeNull();
  });

  it('removes both storage tiers on sign out', async () => {
    session.arenaAuthToken = 'memory';
    local.arenaAuthToken = 'remembered';
    local['arena-cache:example.com/page'] = { result: {}, accessedAt: 0 };

    await auth.signOut();

    expect(await auth.getToken()).toBeNull();
    expect(local['arena-cache:example.com/page']).toBeUndefined();
  });

  it('keeps OAuth unavailable until a public client ID is registered', async () => {
    await expect(auth.signInWithOAuth(false)).rejects.toMatchObject({ kind: 'oauth_unconfigured' });
  });
});
