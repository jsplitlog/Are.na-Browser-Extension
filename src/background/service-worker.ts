import { getAuthState, signInWithOAuth, signOut } from '../core/auth';
import { ACTIVE_PAGE_KEY, type ActivePageRequest } from '../core/active-page';
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
      if (result.status !== 'hit' || !result.connections) return { kind: 'result', result };
      const connectionCounts = Object.fromEntries(result.blocks.flatMap((block) =>
        block.connectionCount === null ? [] : [[block.id, block.connectionCount]]));
      return { kind: 'connections', connections: result.connections, connectionCounts };
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

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || tab.windowId === undefined) return;

  const request = {
    url: tab.url,
    requestedAt: Date.now(),
  } satisfies ActivePageRequest;

  // Start the session handoff before opening, while preserving the action click's
  // user activation for chrome.sidePanel.open(). The panel also observes storage
  // changes, so a slower storage write cannot leave it showing stale page data.
  void chrome.storage.session.set({ [ACTIVE_PAGE_KEY]: request }).catch(() => undefined);
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
});
