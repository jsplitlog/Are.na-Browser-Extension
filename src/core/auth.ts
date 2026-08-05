export interface AuthState {
  signedIn: boolean;
  userSlug: string | null;
  tier: string | null;
}

export interface ValidatedAccount {
  userSlug: string | null;
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

// Set this to the public client ID after registering the extension redirect URI.
// Leaving it empty keeps the PAT route fully usable while preventing a broken OAuth flow.
export const OAUTH_CLIENT_ID = '';
const OAUTH_SCOPE = 'read';

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
    if (token) return { signedIn: true, userSlug: account?.userSlug ?? null, tier: account?.tier ?? null };
  }
  return { signedIn: false, userSlug: null, tier: null };
};

/** Removes local and memory-only credentials. Revoking at Are.na must be done by the user. */
export const signOut = async (): Promise<void> => {
  await Promise.all([
    sessionStorage().remove([TOKEN_KEY, ACCOUNT_KEY]),
    localStorage().remove([TOKEN_KEY, ACCOUNT_KEY]),
    clearCache(),
  ]);
};

const accountFromMe = (body: unknown): ValidatedAccount => {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  return {
    userSlug: typeof data.slug === 'string' ? data.slug : null,
    tier: typeof data.badge === 'string' ? data.badge : null,
  };
};

/** Validates a bearer token without persisting it. */
export const validateToken = async (token: string): Promise<ValidatedAccount> => {
  const credential = token.trim();
  if (!credential) throw new AuthError('invalid_token', 'Enter a personal access token.');
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v3/me`, {
      headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
    });
  } catch {
    throw new AuthError('network', "Couldn't reach Are.na. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new AuthError('invalid_token', 'Your Are.na token was rejected. Check it or create a new one.');
  }
  try {
    return accountFromMe(await response.json());
  } catch {
    throw new AuthError('invalid_token', 'Are.na returned an unexpected account response.');
  }
};

/** Validates before storing, and keeps credentials in local storage only by explicit opt-in. */
export const saveToken = async (token: string, remember: boolean): Promise<ValidatedAccount> => {
  const credential = token.trim();
  const account = await validateToken(credential);
  await signOut();
  const area = remember ? localStorage() : sessionStorage();
  await area.set({ [TOKEN_KEY]: credential, [ACCOUNT_KEY]: account });
  return account;
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

/** Runs Authorization Code + PKCE. The client ID must be registered for this extension's exact redirect. */
export const signInWithOAuth = async (remember: boolean): Promise<ValidatedAccount> => {
  if (!isOAuthConfigured()) {
    throw new AuthError('oauth_unconfigured', 'OAuth sign-in is not configured for this extension yet.');
  }
  const redirectUri = chrome.identity.getRedirectURL();
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
  let callbackUrl: string | undefined;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: `https://www.are.na/oauth/authorize?${params.toString()}`,
      interactive: true,
    });
  } catch {
    throw new AuthError('oauth_cancelled', 'OAuth sign-in was cancelled or could not be opened.');
  }
  if (!callbackUrl) throw new AuthError('oauth_cancelled', 'OAuth sign-in was cancelled.');
  const callback = new URL(callbackUrl);
  if (`${callback.origin}${callback.pathname}` !== redirectUri) {
    throw new AuthError('oauth_state', 'OAuth returned an unexpected redirect.');
  }
  if (callback.searchParams.get('state') !== state) throw new AuthError('oauth_state', 'OAuth state validation failed.');
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
  if (!tokenResponse.ok) throw new AuthError('oauth_exchange', 'Are.na could not exchange the authorization code.');
  const tokenBody: unknown = await tokenResponse.json();
  const accessToken = tokenBody && typeof tokenBody === 'object' && typeof (tokenBody as Record<string, unknown>).access_token === 'string'
    ? (tokenBody as Record<string, string>).access_token : null;
  if (!accessToken) throw new AuthError('oauth_exchange', 'Are.na returned no access token.');
  return saveToken(accessToken, remember);
};
import { clearCache } from './cache';
