import type { ArenaChannel, LookupResult } from './types';

// NOTE: every request carries a URL, never a tabId. Only the popup knows tabs.
// This is what keeps ambient (§1.5) an addition rather than a refactor.
export type Request =
  | { kind: 'lookup'; url: string }                    // phase 1
  | { kind: 'getConnections'; normalizedUrl: string }  // phase 2
  | { kind: 'getAuthState' }
  | { kind: 'signIn' }
  | { kind: 'signOut' };

export type Response =
  | { kind: 'result'; result: LookupResult }
  | {
    kind: 'connections';
    connections: Record<number, ArenaChannel[]>;
    connectionCounts: Record<number, number>;
  }
  | { kind: 'authState'; signedIn: boolean; userSlug: string | null; tier: string | null }
  | { kind: 'ok' };
