import { completeOAuth, getAuthState, signInWithOAuth, signOut } from '../core/auth';
import { ACTIVE_PAGE_KEY, type ActivePageRequest } from '../core/active-page';
import { createRequestBudget } from '../core/arena';
import { getCached } from '../core/cache';
import { isRequest, type Request, type Response } from '../core/messages';
import { blocksFor, connectionsFor } from '../core/resolve';
import type { LookupResult } from '../core/types';
import { platform } from '../platform';

const lookups = new Map<string, Promise<LookupResult>>();
const connections = new Map<string, Promise<LookupResult>>();

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
  const pending = blocksFor(url, budget).finally(() => lookups.delete(url));
  lookups.set(url, pending);
  return pending;
};

const loadConnections = async (normalizedUrl: string): Promise<LookupResult> => {
  const existing = connections.get(normalizedUrl);
  if (existing) return existing;
  const pending = (async () => {
    const cached = await getCached(normalizedUrl);
    if (!cached) return errorResult(normalizedUrl);
    return connectionsFor(cached);
  })().finally(() => {
    connections.delete(normalizedUrl);
  });
  connections.set(normalizedUrl, pending);
  return pending;
};

const route = async (request: Request, sender?: chrome.runtime.MessageSender): Promise<Response> => {
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
      await signInWithOAuth(request.remember);
      return { kind: 'ok' };
    case 'signOut':
      await signOut();
      return { kind: 'ok' };
    case 'oauthCallback': {
      // Delivering this message is itself what revives a suspended background
      // page on Safari/iOS — see src/content/oauth-callback.ts. completeOAuth
      // validates the URL against the persisted flow before trusting it.
      await completeOAuth(request.url);
      // The redirect page has served its purpose; close the tab it arrived on.
      if (sender?.tab?.id !== undefined) void chrome.tabs.remove(sender.tab.id).catch(() => undefined);
      return { kind: 'ok' };
    }
  }
};

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRequest(message)) {
    sendResponse({ kind: 'error', message: 'Unsupported request.' } satisfies Response);
    return true;
  }
  void route(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not complete the request.',
    } satisfies Response));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || tab.windowId === undefined) return;

  const request = {
    url: tab.url,
    requestedAt: Date.now(),
  } satisfies ActivePageRequest;

  // Start the session handoff before opening, while preserving the action click's
  // user activation for platform.openPanel() (a synchronous call into the target's
  // panel-open API — see src/platform/). The panel also observes storage changes,
  // so a slower storage write cannot leave it showing stale page data.
  void chrome.storage.session.set({ [ACTIVE_PAGE_KEY]: request }).catch(() => undefined);
  void platform.openPanel(tab).catch(() => undefined);
});
