import { clearCache } from './cache';
import { platform } from '../platform';

export interface AuthState {
  signedIn: boolean;
  displayName: string | null;
  userSlug: string | null;
  avatarUrl: string | null;
  tier: string | null;
}

export interface ValidatedAccount {
  displayName: string | null;
  userSlug: string | null;
  avatarUrl: string | null;
  tier: string | null;
}

export class AuthError extends Error {
  constructor(public readonly kind: 'invalid_token' | 'network' | 'oauth_unconfigured' | 'oauth_cancelled' | 'oauth_state' | 'oauth_exchange', message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const API_ORIGIN = 'https://api.are.na';
const TOKEN_KEY = 'arenaAuthToken';
const ACCOUNT_KEY = 'arenaAuthAccount';

// Public OAuth client ID for the read-only Are.na Connections application.
// Browser extensions cannot keep a client secret; PKCE protects the code exchange.
export const OAUTH_CLIENT_ID = 'mP1ReD37o-hXKtpQLwOCaG9z77L4OkRzy9vbAMMsMW0';
const OAUTH_SCOPE = 'read';
const OAUTH_REDIRECT_PATH = 'oauth2';

type StoredAccount = ValidatedAccount;
type AuthStorage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

const sessionStorage = (): AuthStorage => chrome.storage.session;
const localStorage = (): AuthStorage => chrome.storage.local;

const readStored = async (area: AuthStorage): Promise<{ token: string | null; account: StoredAccount | null }> => {
  const stored = await area.get([TOKEN_KEY, ACCOUNT_KEY]);
  const token = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : null;
  const candidate = stored[ACCOUNT_KEY];
  const account = candidate && typeof candidate === 'object'
    ? candidate as StoredAccount
    : null;
  return { token, account };
};

/** Returns the memory-only token first, then the explicit remembered token. */
export const getToken = async (): Promise<string | null> => {
  const session = await readStored(sessionStorage());
  if (session.token) return session.token;
  return (await readStored(localStorage())).token;
};

export const getAuthState = async (): Promise<AuthState> => {
  for (const area of [sessionStorage(), localStorage()]) {
    const { token, account } = await readStored(area);
    if (token) return {
      signedIn: true,
      displayName: account?.displayName ?? null,
      userSlug: account?.userSlug ?? null,
      avatarUrl: account?.avatarUrl ?? null,
      tier: account?.tier ?? null,
    };
  }
  return { signedIn: false, displayName: null, userSlug: null, avatarUrl: null, tier: null };
};

/** Removes local and memory-only credentials. Revoking at Are.na must be done by the user.
 *  Also drops any abandoned pending OAuth flow: storeAccessToken routes every
 *  successful sign-in through here, so a token paste can't leave a stale
 *  pending record (and, on Safari, its parked tab) primed to complete later. */
export const signOut = async (): Promise<void> => {
  await Promise.all([
    sessionStorage().remove([TOKEN_KEY, ACCOUNT_KEY, PENDING_OAUTH_KEY]),
    localStorage().remove([TOKEN_KEY, ACCOUNT_KEY]),
    clearCache(),
  ]);
};

const accountFromMe = (body: unknown): ValidatedAccount => {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const avatar = data.avatar;
  const avatarRecord = avatar && typeof avatar === 'object' ? avatar as Record<string, unknown> : {};
  return {
    displayName: typeof data.name === 'string' ? data.name : null,
    userSlug: typeof data.slug === 'string' ? data.slug : null,
    avatarUrl: typeof avatar === 'string'
      ? avatar
      : typeof avatarRecord.src === 'string'
        ? avatarRecord.src
        : typeof avatarRecord.url === 'string' ? avatarRecord.url : null,
    tier: typeof data.badge === 'string' ? data.badge : null,
  };
};

/** Validates an OAuth access token without persisting it. */
const validateAccessToken = async (token: string): Promise<ValidatedAccount> => {
  const credential = token.trim();
  if (!credential) throw new AuthError('invalid_token', 'Are.na returned no access token.');
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v3/me`, {
      headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
    });
  } catch {
    throw new AuthError('network', "Couldn't reach Are.na. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new AuthError('invalid_token', 'Are.na rejected this connection. Sign in again.');
  }
  try {
    return accountFromMe(await response.json());
  } catch {
    throw new AuthError('invalid_token', 'Are.na returned an unexpected account response.');
  }
};

/** Validates before storing, and keeps OAuth credentials locally only by explicit opt-in. */
const storeAccessToken = async (token: string, remember: boolean): Promise<ValidatedAccount> => {
  const credential = token.trim();
  const account = await validateAccessToken(credential);
  await signOut();
  const area = remember ? localStorage() : sessionStorage();
  await area.set({ [TOKEN_KEY]: credential, [ACCOUNT_KEY]: account });
  return account;
};

/** Signs in with a manually-pasted Are.na personal access token. This never
 *  depends on the platform adapter, so it works identically on every target.
 *  No target currently renders the form (`offersTokenSignIn` is false
 *  everywhere) — it's the recovery path if Safari's hosted redirect breaks. */
export const signInWithToken = async (token: string, remember: boolean): Promise<ValidatedAccount> => {
  const credential = token.trim();
  if (!credential) throw new AuthError('invalid_token', 'Enter an access token.');
  return storeAccessToken(credential, remember);
};

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const randomBase64url = (length: number): string => base64url(crypto.getRandomValues(new Uint8Array(length)));

const pkceChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
};

export const isOAuthConfigured = (): boolean => OAUTH_CLIENT_ID.length > 0;

export const getOAuthRedirectUri = (): string => platform.getRedirectURL(OAUTH_REDIRECT_PATH);

/** Everything `completeOAuth` needs to finish a flow it did not start. Persisted
 *  rather than closed over, because on targets whose OAuth spans a background
 *  suspension (Safari, and iOS especially) nothing in memory survives the trip. */
interface PendingOAuth {
  verifier: string;
  state: string;
  redirectUri: string;
  remember: boolean;
}

const PENDING_OAUTH_KEY = 'arenaPendingOAuth';

const isPendingOAuth = (value: unknown): value is PendingOAuth => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.verifier === 'string'
    && typeof candidate.state === 'string'
    && typeof candidate.redirectUri === 'string'
    && typeof candidate.remember === 'boolean';
};

const readPendingOAuth = async (): Promise<PendingOAuth | null> => {
  const stored = await sessionStorage().get(PENDING_OAUTH_KEY);
  const candidate = stored[PENDING_OAUTH_KEY];
  return isPendingOAuth(candidate) ? candidate : null;
};

/** Mints PKCE + state, persists them, and returns the authorize URL to open. */
export const beginOAuth = async (remember: boolean): Promise<string> => {
  if (!isOAuthConfigured()) {
    throw new AuthError('oauth_unconfigured', 'OAuth sign-in is not configured for this extension yet.');
  }
  const redirectUri = getOAuthRedirectUri();
  const verifier = randomBase64url(32);
  const state = randomBase64url(16);
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  await sessionStorage().set({
    [PENDING_OAUTH_KEY]: { verifier, state, redirectUri, remember } satisfies PendingOAuth,
  });
  return `https://www.are.na/oauth/authorize?${params.toString()}`;
};

/** Serializes completions: the macOS tabs.onUpdated fast path and a popup
 *  completeOAuth message can race on the same background page, and both
 *  reading the pending record before either's remove lands would double-spend
 *  the code. The second caller instead waits and finds the record consumed. */
let completionChain: Promise<unknown> = Promise.resolve();

const serializeCompletion = <T>(run: () => Promise<T>): Promise<T> => {
  const next = completionChain.then(run, run);
  completionChain = next.catch(() => undefined);
  return next;
};

/** Validates a callback URL against the persisted pending flow and exchanges the
 *  code for a token. Safe to call from a top-level listener on a revived
 *  background page — it reads its state from storage, not from a closure. */
export const completeOAuth = (callbackUrl: string): Promise<ValidatedAccount> =>
  serializeCompletion(() => completeOAuthLocked(callbackUrl));

const completeOAuthLocked = async (callbackUrl: string): Promise<ValidatedAccount> => {
  const pending = await readPendingOAuth();
  if (!pending) throw new AuthError('oauth_state', 'No sign-in was in progress.');
  // Clear first: a code is single-use, so a retried or duplicated callback must
  // not be able to replay this record.
  await sessionStorage().remove([PENDING_OAUTH_KEY]);
  const { verifier, state, redirectUri, remember } = pending;
  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new AuthError('oauth_state', 'OAuth returned an invalid redirect.');
  }
  if (`${callback.origin}${callback.pathname}` !== redirectUri) {
    throw new AuthError('oauth_state', 'OAuth returned an unexpected redirect.');
  }
  if (callback.searchParams.get('state') !== state) throw new AuthError('oauth_state', 'OAuth state validation failed.');
  const providerError = callback.searchParams.get('error');
  if (providerError) {
    const description = callback.searchParams.get('error_description')?.trim();
    throw new AuthError('oauth_cancelled', description || 'Are.na sign-in was cancelled.');
  }
  const code = callback.searchParams.get('code');
  if (!code) throw new AuthError('oauth_exchange', 'Are.na did not return an authorization code.');
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(`${API_ORIGIN}/v3/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: OAUTH_CLIENT_ID, redirect_uri: redirectUri, code, code_verifier: verifier }),
    });
  } catch {
    throw new AuthError('network', "Couldn't reach Are.na to finish OAuth sign-in.");
  }
  let tokenBody: unknown = null;
  try {
    tokenBody = await tokenResponse.json();
  } catch {
    // The response status below still distinguishes a rejected exchange from
    // an unexpected successful response without leaking raw provider output.
  }
  const tokenRecord = tokenBody && typeof tokenBody === 'object' ? tokenBody as Record<string, unknown> : {};
  if (!tokenResponse.ok) {
    const description = typeof tokenRecord.error_description === 'string' ? tokenRecord.error_description.trim() : '';
    throw new AuthError('oauth_exchange', description || 'Are.na could not exchange the authorization code.');
  }
  const accessToken = typeof tokenRecord.access_token === 'string' ? tokenRecord.access_token : null;
  if (!accessToken) throw new AuthError('oauth_exchange', 'Are.na returned no access token.');
  return storeAccessToken(accessToken, remember);
};

/** Popup-driven completion (Safari): pick the one candidate that belongs to
 *  the pending flow before anything is consumed. `completeOAuth` clears the
 *  pending record up front — the right call for a single callback, but it
 *  means a stale parked tab (an abandoned or failed earlier attempt) would
 *  eat the record and dead-end the real callback, looping every retry. So
 *  candidates are matched on redirect + state first, and only an actual
 *  match proceeds to the consuming path. No match returns null with the
 *  pending record untouched: parked strangers are garbage to sweep, not an
 *  error, and a flow started elsewhere can still finish. */
export const completeOAuthFromCandidates = (callbackUrls: string[]): Promise<ValidatedAccount | null> =>
  serializeCompletion(async () => {
    if (!callbackUrls.length) return null;
    const pending = await readPendingOAuth();
    if (!pending) {
      // Parked callback tabs with nothing to complete: the user came back from
      // are.na but the pending record is gone (expired session storage, or a
      // completed/abandoned flow). Say so rather than silently re-showing the
      // sign-in card — the caller sweeps the dead tabs either way.
      throw new AuthError('oauth_state', 'Sign-in expired — start it again.');
    }
    const match = callbackUrls.find((url) => {
      try {
        const callback = new URL(url);
        return `${callback.origin}${callback.pathname}` === pending.redirectUri
          && callback.searchParams.get('state') === pending.state;
      } catch {
        return false;
      }
    });
    // No state match: every candidate is a stale tab from an earlier attempt.
    // Leave the pending record intact — the real callback may still arrive.
    if (!match) return null;
    return completeOAuthLocked(match);
  });

/** Runs Authorization Code + PKCE. The client ID must be registered for this
 *  extension's exact redirect.
 *
 *  Two shapes, chosen by the adapter. Where the browser hands the callback back
 *  in-process (`chrome.identity` on Chrome and Firefox), this awaits the whole
 *  flow and resolves with the account. Where it does not
 *  (`completesAuthInBackground` — Safari's tab-based flow), this returns once
 *  the tab is open: the page that started it is already gone, and a top-level
 *  listener registered in background/service-worker.ts finishes the exchange. */
export const signInWithOAuth = async (remember: boolean): Promise<ValidatedAccount | null> => {
  const authorizeUrl = await beginOAuth(remember);
  if (platform.completesAuthInBackground) {
    try {
      await platform.launchAuthFlow(authorizeUrl);
    } catch {
      await sessionStorage().remove([PENDING_OAUTH_KEY]);
      throw new AuthError('oauth_cancelled', 'OAuth sign-in could not be opened.');
    }
    return null;
  }
  let callbackUrl: string | undefined;
  try {
    callbackUrl = await platform.launchAuthFlow(authorizeUrl);
  } catch {
    await sessionStorage().remove([PENDING_OAUTH_KEY]);
    throw new AuthError('oauth_cancelled', 'OAuth sign-in was cancelled or could not be opened.');
  }
  if (!callbackUrl) {
    await sessionStorage().remove([PENDING_OAUTH_KEY]);
    throw new AuthError('oauth_cancelled', 'OAuth sign-in was cancelled.');
  }
  return completeOAuth(callbackUrl);
};
