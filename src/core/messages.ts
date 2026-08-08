import type { ArenaChannel, LookupResult } from './types';

// NOTE: every request carries a URL, never a tabId. Only the popup knows tabs.
// This is what keeps ambient (§1.5) an addition rather than a refactor.
export type Request =
  | { kind: 'lookup'; url: string }                    // phase 1
  | { kind: 'getConnections'; normalizedUrl: string }  // phase 2
  | { kind: 'getAuthState' }
  | { kind: 'signIn'; remember: boolean }
  | { kind: 'completeOAuth'; callbackUrl: string }
  | { kind: 'signOut' };

/** Anything can post to a service worker, so the router only ever sees vetted shapes. */
export const isRequest = (value: unknown): value is Request => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  switch (request.kind) {
    case 'lookup': return typeof request.url === 'string';
    case 'getConnections': return typeof request.normalizedUrl === 'string';
    case 'signIn': return typeof request.remember === 'boolean';
    case 'completeOAuth': return typeof request.callbackUrl === 'string';
    case 'getAuthState':
    case 'signOut': return true;
    default: return false;
  }
};

export type Response =
  | { kind: 'result'; result: LookupResult }
  | {
    kind: 'connections';
    connections: Record<number, ArenaChannel[]>;
    connectionCounts: Record<number, number>;
  }
  | {
    kind: 'authState';
    signedIn: boolean;
    displayName: string | null;
    userSlug: string | null;
    avatarUrl: string | null;
    tier: string | null;
  }
  | { kind: 'error'; message: string }
  | { kind: 'ok' };
