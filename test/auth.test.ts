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

const getRedirectURL = vi.fn((path = '') => `https://unit-test.chromiumapp.org/${path}`);
const launchWebAuthFlow = vi.fn();

vi.stubGlobal('chrome', {
  storage: { session: area(session), local: area(local) },
  identity: { getRedirectURL, launchWebAuthFlow },
});

const auth = await import('../src/core/auth');

beforeEach(() => {
  Object.keys(session).forEach((key) => delete session[key]);
  Object.keys(local).forEach((key) => delete local[key]);
  vi.stubGlobal('fetch', vi.fn());
  getRedirectURL.mockClear();
  launchWebAuthFlow.mockReset();
});

const prepareOAuth = (accessToken: string, accountResponse: Response): void => {
  launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://unit-test.chromiumapp.org/oauth2?code=authorization-code&state=${state}`;
  });
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }))
    .mockResolvedValueOnce(accountResponse);
};

describe('auth', () => {
  it('validates /v3/me before saving a session-only OAuth connection', async () => {
    prepareOAuth('session-access-token', new Response(JSON.stringify({ data: { slug: 'me', badge: 'Supporter' } }), { status: 200 }));

    await auth.signInWithOAuth(false);

    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.are.na/v3/me', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer session-access-token' }) }));
    expect(await auth.getToken()).toBe('session-access-token');
    expect(local.arenaAuthToken).toBeUndefined();
    expect(await auth.getAuthState()).toEqual({
      signedIn: true,
      displayName: null,
      userSlug: 'me',
      avatarUrl: null,
      tier: 'Supporter',
    });
  });

  it('only writes an OAuth connection to local storage when remember is selected', async () => {
    prepareOAuth('remembered-access-token', new Response(JSON.stringify({ data: {} }), { status: 200 }));

    await auth.signInWithOAuth(true);

    expect(local.arenaAuthToken).toBe('remembered-access-token');
    expect(session.arenaAuthToken).toBeUndefined();
  });

  it('does not persist an OAuth access token rejected by Are.na', async () => {
    prepareOAuth('rejected-access-token', new Response('', { status: 401 }));

    await expect(auth.signInWithOAuth(false)).rejects.toMatchObject({ kind: 'invalid_token' });
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

  it('signs in through Authorization Code + PKCE with read-only scope', async () => {
    let authorizationUrl = '';
    launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      authorizationUrl = url;
      const state = new URL(url).searchParams.get('state');
      return `https://unit-test.chromiumapp.org/oauth2?code=authorization-code&state=${state}`;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          name: 'OAuth User',
          slug: 'oauth-user',
          avatar: { src: 'https://static.are.na/oauth-user.jpg' },
          badge: 'Premium',
        },
      }), { status: 200 }));

    await expect(auth.signInWithOAuth(false)).resolves.toEqual({
      displayName: 'OAuth User',
      userSlug: 'oauth-user',
      avatarUrl: 'https://static.are.na/oauth-user.jpg',
      tier: 'Premium',
    });

    expect(getRedirectURL).toHaveBeenCalledWith('oauth2');
    const authorization = new URL(authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://www.are.na/oauth/authorize');
    expect(authorization.searchParams.get('client_id')).toBe(auth.OAUTH_CLIENT_ID);
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://unit-test.chromiumapp.org/oauth2');
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('scope')).toBe('read');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');

    const exchange = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    const verifier = exchange.get('code_verifier') ?? '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(authorization.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('client_id')).toBe(auth.OAUTH_CLIENT_ID);
    expect(exchange.get('redirect_uri')).toBe('https://unit-test.chromiumapp.org/oauth2');
    expect(exchange.get('code')).toBe('authorization-code');
    expect(await auth.getToken()).toBe('oauth-token');
  });

  it('rejects an OAuth callback with the wrong state before exchanging it', async () => {
    launchWebAuthFlow.mockResolvedValue('https://unit-test.chromiumapp.org/oauth2?code=authorization-code&state=wrong');

    await expect(auth.signInWithOAuth(false)).rejects.toMatchObject({ kind: 'oauth_state' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a provider denial without attempting an exchange', async () => {
    launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get('state');
      return `https://unit-test.chromiumapp.org/oauth2?error=access_denied&error_description=Access%20was%20denied.&state=${state}`;
    });

    await expect(auth.signInWithOAuth(false)).rejects.toMatchObject({ kind: 'oauth_cancelled', message: 'Access was denied.' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the provider exchange error when Are.na rejects the code', async () => {
    launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get('state');
      return `https://unit-test.chromiumapp.org/oauth2?code=expired-code&state=${state}`;
    });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error_description: 'Authorization code expired.' }), { status: 400 }));

    await expect(auth.signInWithOAuth(false)).rejects.toMatchObject({
      kind: 'oauth_exchange',
      message: 'Authorization code expired.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// Safari's tab-based flow spans a background suspension: on iOS the page that
// started sign-in is destroyed when the auth tab opens, so completeOAuth runs
// later, on a revived background page, with nothing in memory. These exercise
// that split directly — begin and complete never share a closure.
describe('resumable OAuth (beginOAuth / completeOAuth)', () => {
  const redirect = 'https://unit-test.chromiumapp.org/oauth2';

  const beginAndReadState = async (remember: boolean): Promise<string> => {
    const authorizeUrl = await auth.beginOAuth(remember);
    const state = new URL(authorizeUrl).searchParams.get('state');
    expect(state).toBeTruthy();
    return state as string;
  };

  it('persists the pending flow so a later call can finish it', async () => {
    const state = await beginAndReadState(false);

    // Everything completeOAuth needs is in storage, not in a promise.
    expect(session.arenaPendingOAuth).toMatchObject({ state, remember: false });

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'resumed-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));

    await auth.completeOAuth(`${redirect}?code=authorization-code&state=${state}`);

    expect(await auth.getToken()).toBe('resumed-token');
  });

  it('honours remember across the suspension, storing to local rather than session', async () => {
    const state = await beginAndReadState(true);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'remembered-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));

    await auth.completeOAuth(`${redirect}?code=authorization-code&state=${state}`);

    expect(local.arenaAuthToken).toBe('remembered-token');
  });

  it('rejects a callback whose state does not match the persisted flow', async () => {
    await beginAndReadState(false);

    await expect(auth.completeOAuth(`${redirect}?code=c&state=forged`))
      .rejects.toMatchObject({ kind: 'oauth_state' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a callback to an unexpected redirect', async () => {
    const state = await beginAndReadState(false);

    await expect(auth.completeOAuth(`https://attacker.example/oauth2?code=c&state=${state}`))
      .rejects.toMatchObject({ kind: 'oauth_state' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the pending flow so a replayed callback cannot reuse it', async () => {
    const state = await beginAndReadState(false);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'once-only' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));

    await auth.completeOAuth(`${redirect}?code=authorization-code&state=${state}`);
    expect(session.arenaPendingOAuth).toBeUndefined();

    // A single-use code arriving twice must not start a second exchange.
    await expect(auth.completeOAuth(`${redirect}?code=authorization-code&state=${state}`))
      .rejects.toMatchObject({ kind: 'oauth_state' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects when no flow is pending at all', async () => {
    await expect(auth.completeOAuth(`${redirect}?code=c&state=whatever`))
      .rejects.toMatchObject({ kind: 'oauth_state' });
  });

  it('picks the state-matching candidate among stale parked callbacks', async () => {
    const state = await beginAndReadState(false);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'picked-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));

    // Stale first: an abandoned earlier attempt must not consume the record.
    const account = await auth.completeOAuthFromCandidates([
      `${redirect}?code=stale&state=from-an-abandoned-attempt`,
      'not a url at all',
      `${redirect}?code=authorization-code&state=${state}`,
    ]);

    expect(account).not.toBeNull();
    expect(await auth.getToken()).toBe('picked-token');
  });

  it('leaves the pending flow intact when no candidate matches', async () => {
    const state = await beginAndReadState(false);

    await expect(auth.completeOAuthFromCandidates([
      `${redirect}?code=stale&state=someone-elses`,
    ])).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(session.arenaPendingOAuth).toMatchObject({ state });

    // The surviving record still finishes against the real callback.
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'survivor' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));
    await auth.completeOAuth(`${redirect}?code=real&state=${state}`);
    expect(await auth.getToken()).toBe('survivor');
  });

  it('reports an expired flow when callbacks are parked but nothing is pending', async () => {
    // The user came back from are.na with a callback tab open, but the pending
    // record is gone (expired storage, completed elsewhere): silence here reads
    // as the extension ignoring them, so it must surface as an error.
    await expect(auth.completeOAuthFromCandidates([
      `${redirect}?code=c&state=whatever`,
    ])).rejects.toMatchObject({ kind: 'oauth_state' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears an abandoned pending flow when a token sign-in supersedes it', async () => {
    await beginAndReadState(false);
    expect(session.arenaPendingOAuth).toBeDefined();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { slug: 'me' } }), { status: 200 }));

    await auth.signInWithToken('pasted-token', false);

    expect(session.arenaPendingOAuth).toBeUndefined();
  });
});
