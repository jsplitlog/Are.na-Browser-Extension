import { completeOAuth, completeOAuthFromCandidates, getAuthState, signInWithOAuth, signOut } from '../core/auth';
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
      await signInWithOAuth(request.remember);
      return { kind: 'ok' };
    case 'completeOAuth':
      // Popup-driven completion for Safari: iOS never delivers tabs.onUpdated
      // to this page (verified in docs/ios-findings.md), so the popup finds
      // parked callback tabs on reopen and hands their URLs over. The message
      // itself revives this page — the same wake path every other request
      // rides. Selection by pending-state match happens in core/auth.ts so a
      // stale parked tab can't consume the single-use pending record.
      await completeOAuthFromCandidates(request.callbackUrls);
      return { kind: 'ok' };
    case 'signOut':
      await signOut();
      return { kind: 'ok' };
  }
};

// Registered at the top level, before any await, so the browser can revive a
// suspended background page to deliver the OAuth callback. On Safari — iOS
// especially — the page that started the flow is already gone by the time the
// redirect lands, so this is the only thing left to finish sign-in. No-op on
// Chrome and Firefox, where chrome.identity resolves the flow in-process.
platform.registerAuthCallback((callbackUrl) => {
  void completeOAuth(callbackUrl).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRequest(message)) {
    sendResponse({ kind: 'error', message: 'Unsupported request.' } satisfies Response);
    return true;
  }
  void route(message)
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
