import { getAuthState, signInWithOAuth, signOut } from '../core/auth';
import { createRequestBudget, type RequestBudget } from '../core/arena';
import { getCached } from '../core/cache';
import type { Request, Response } from '../core/messages';
import { blocksFor, connectionsFor } from '../core/resolve';
import type { LookupResult } from '../core/types';

const lookups = new Map<string, Promise<LookupResult>>();
const connections = new Map<string, Promise<LookupResult>>();
const budgets = new Map<string, RequestBudget>();

const errorResult = (normalizedUrl: string): LookupResult => ({
  normalizedUrl,
  status: 'error',
  blocks: [],
  fetchedAt: Date.now(),
});

const lookup = async (url: string): Promise<LookupResult> => {
  const existing = lookups.get(url);
  if (existing) return existing;
  const budget = createRequestBudget(10);
  const pending = blocksFor(url, budget).then((result) => {
    if (result.status === 'hit') budgets.set(result.normalizedUrl, budget);
    return result;
  }).finally(() => lookups.delete(url));
  lookups.set(url, pending);
  return pending;
};

const loadConnections = async (normalizedUrl: string): Promise<LookupResult> => {
  const existing = connections.get(normalizedUrl);
  if (existing) return existing;
  const pending = (async () => {
    const cached = await getCached(normalizedUrl);
    if (!cached) return errorResult(normalizedUrl);
    return connectionsFor(cached, budgets.get(normalizedUrl) ?? createRequestBudget(8));
  })().finally(() => {
    connections.delete(normalizedUrl);
    budgets.delete(normalizedUrl);
  });
  connections.set(normalizedUrl, pending);
  return pending;
};

const route = async (request: Request): Promise<Response> => {
  switch (request.kind) {
    case 'lookup':
      return { kind: 'result', result: await lookup(request.url) };
    case 'getConnections': {
      const result = await loadConnections(request.normalizedUrl);
      return result.status === 'hit' && result.connections
        ? { kind: 'connections', connections: result.connections }
        : { kind: 'result', result };
    }
    case 'getAuthState': {
      const state = await getAuthState();
      return { kind: 'authState', ...state };
    }
    case 'signIn':
      await signInWithOAuth(false);
      return { kind: 'ok' };
    case 'signOut':
      await signOut();
      return { kind: 'ok' };
  }
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as Request;
  void route(request)
    .then(sendResponse)
    .catch(() => sendResponse({ kind: 'result', result: errorResult('') } satisfies Response));
  return true;
});
