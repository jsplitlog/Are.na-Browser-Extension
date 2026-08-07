import { ACTIVE_PAGE_KEY, type ActivePageRequest } from '../core/active-page';
import type { PlatformAdapter } from './index';

// WS2: Safari has neither `chrome.sidePanel` nor `chrome.identity`. The action
// popup (manifest overlay owns `action.default_popup`) replaces the side panel
// entirely, and the tab-based Authorization Code + PKCE flow below replaces
// `chrome.identity.launchWebAuthFlow`.
//
// TODO(j): Safari needs a stable https redirect URI we control, registered on
// the Are.na OAuth application (see docs/cross-browser-plan.md "Human tasks").
// Nothing here can invent that URI safely, so it stays an empty placeholder —
// `requireConfiguredRedirectUrl` throws a clear, actionable error rather than
// silently opening a fake domain. Once the real URI exists:
//   1. Set SAFARI_OAUTH_REDIRECT_URL below.
//   2. Flip `supportsOAuth` to `true`.
// `launchAuthFlow` is otherwise fully implemented and needs no further changes.
const SAFARI_OAUTH_REDIRECT_URL = '';

const requireConfiguredRedirectUrl = (): string => {
  if (!SAFARI_OAUTH_REDIRECT_URL) {
    throw new Error(
      'Safari OAuth redirect is not configured yet (see the TODO in src/platform/safari.ts). Use token sign-in.',
    );
  }
  return SAFARI_OAUTH_REDIRECT_URL;
};

const AUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;

type SettleResult = { ok: true; url: string } | { ok: false; error: Error };

/** Opens `authorizeUrl` in a new tab and resolves once that tab navigates to
 *  `redirectUrl` (matched by prefix, since the callback carries a query
 *  string), the user closes the tab, or the flow times out. Always closes the
 *  tab and removes its listeners exactly once, on every path. */
const launchTabBasedAuthFlow = (authorizeUrl: string, redirectUrl: string): Promise<string | undefined> =>
  new Promise((resolveFlow, reject) => {
    let settled = false;
    let createdTabId: number | undefined;

    const onUpdated = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void => {
      if (tabId !== createdTabId || !changeInfo.url) return;
      if (changeInfo.url.startsWith(redirectUrl)) settle({ ok: true, url: changeInfo.url });
    };

    // The user closing the auth tab manually is a cancellation, not an error path.
    const onRemoved = (tabId: number): void => {
      if (tabId === createdTabId) settle({ ok: false, error: new Error('The sign-in tab was closed.') });
    };

    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error('Sign-in timed out.') });
    }, AUTH_FLOW_TIMEOUT_MS);

    const cleanup = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };

    const settle = (result: SettleResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (createdTabId !== undefined) void chrome.tabs.remove(createdTabId).catch(() => undefined);
      if (result.ok) resolveFlow(result.url);
      else reject(result.error);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.create({ url: authorizeUrl, active: true })
      .then((tab) => {
        if (settled) {
          // Already settled (e.g. an instant timeout) before creation resolved.
          if (tab.id !== undefined) void chrome.tabs.remove(tab.id).catch(() => undefined);
          return;
        }
        createdTabId = tab.id;
        if (createdTabId === undefined) settle({ ok: false, error: new Error('Could not open the sign-in tab.') });
      })
      .catch((error: unknown) => {
        settle({ ok: false, error: error instanceof Error ? error : new Error('Could not open the sign-in tab.') });
      });
  });

export const safariPlatform: PlatformAdapter = {
  // Flip to true only once SAFARI_OAUTH_REDIRECT_URL above is a real,
  // registered redirect URI. Until then the sidepanel hides the OAuth button
  // (see src/sidepanel/sidepanel.ts) and users sign in via token paste-in
  // (core/auth.ts signInWithToken), which does not depend on this adapter.
  supportsOAuth: false,
  openPanel: async () => {
    // No-op: Safari opens the action popup itself; there is nothing to trigger here.
  },
  getRedirectURL: () => requireConfiguredRedirectUrl(),
  launchAuthFlow: (url) => launchTabBasedAuthFlow(url, requireConfiguredRedirectUrl()),
};

/** Safari drops `action.onClicked` once a popup is configured (the popup
 *  supersedes it), so background/service-worker.ts's click-driven
 *  ACTIVE_PAGE_KEY handoff never fires on this target. This repeats that same
 *  session write, driven by the popup's own open instead of a toolbar click:
 *  `tabs.query({active, currentWindow})` reads the tab that was active when
 *  the (already user-gesture-gated) popup opened.
 *
 *  This lives as a plain export here rather than a new PlatformAdapter method
 *  so it doesn't require touching src/platform/index.ts, chrome.ts, or
 *  firefox.ts. src/sidepanel/sidepanel.ts imports and calls it only behind
 *  `__TARGET__ === 'safari'`, so Rollup's dead-branch elimination drops it
 *  (and this file's chrome.tabs usage) out of the Chrome/Firefox bundles —
 *  the same pattern src/platform/index.ts already uses for the adapter
 *  ternary itself. */
export const resolveActivePageForPopup = async (): Promise<void> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  const request: ActivePageRequest = { url: tab.url, requestedAt: Date.now() };
  await chrome.storage.session.set({ [ACTIVE_PAGE_KEY]: request });
};
