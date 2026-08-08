import { ACTIVE_PAGE_KEY, type ActivePageRequest } from '../core/active-page';
import type { PlatformAdapter } from './index';

// Safari has neither `chrome.sidePanel` nor `chrome.identity`. The action popup
// (manifest overlay owns `action.default_popup`) replaces the side panel, and
// the tab-based Authorization Code + PKCE flow below replaces
// `chrome.identity.launchWebAuthFlow`.
//
// Chrome and Firefox each get a redirect origin their own browser intercepts
// (`.chromiumapp.org`, `.extensions.allizom.org`). Safari has no equivalent, so
// the callback has to be a real https URL — this one is a static, script-free
// page served by GitHub Pages from `site/oauth2.html`. Only the single-use
// authorization code ever reaches it; the PKCE verifier and the access token
// stay inside the extension (see core/auth.ts).
//
// Three things must stay in lockstep, or sign-in fails closed:
//   1. This constant.
//   2. `host_permissions` in public/manifest.safari.json — without host access
//      to this origin, `tabs.onUpdated` withholds `changeInfo.url` and the
//      watcher below never sees the callback.
//   3. The redirect URI registered on the Are.na OAuth application.
// core/auth.ts compares `origin + pathname` against this value exactly, so the
// explicit `.html` matters: a bare directory path would be 301'd to a trailing
// slash by Pages and fail that check.
const SAFARI_OAUTH_REDIRECT_URL = 'https://jsplitlog.github.io/arena-connections/oauth2.html';

const requireConfiguredRedirectUrl = (): string => {
  if (!SAFARI_OAUTH_REDIRECT_URL) {
    throw new Error(
      'Safari OAuth redirect is not configured yet (see the TODO in src/platform/safari.ts). Use token sign-in.',
    );
  }
  return SAFARI_OAUTH_REDIRECT_URL;
};

export const safariPlatform: PlatformAdapter = {
  supportsOAuth: true,
  // Unlike Chrome and Firefox, Safari's flow depends on a page we host. Token
  // paste-in stays on the sign-in card as a permanent fallback, so a Pages
  // outage or a repo rename degrades sign-in rather than breaking it.
  offersTokenSignIn: true,
  openPanel: async () => {
    // No-op: Safari opens the action popup itself; there is nothing to trigger here.
  },
  getRedirectURL: () => requireConfiguredRedirectUrl(),
  // Opens the authorize tab and returns — deliberately without waiting for the
  // callback. Waiting was the original design and it fails on iOS: opening the
  // tab dismisses the popup sheet, and with no UI attached iOS suspends the
  // background page, taking any in-memory promise and dynamically-added
  // listener with it. The callback is picked up by registerAuthCallback below
  // instead, which survives that suspension.
  launchAuthFlow: async (url) => {
    await chrome.tabs.create({ url, active: true });
    return undefined;
  },
  completesAuthInBackground: true,
  registerAuthCallback: (onCallback) => {
    const redirectUrl = SAFARI_OAUTH_REDIRECT_URL;
    if (!redirectUrl) return;
    // Prefix match: the callback carries ?code=&state= on top of the redirect.
    // The event's own tabId identifies the auth tab, so nothing has to be
    // remembered across the suspension to close it afterwards.
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!changeInfo.url?.startsWith(redirectUrl)) return;
      onCallback(changeInfo.url);
      void chrome.tabs.remove(tabId).catch(() => undefined);
    });
  },
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

/** The popup-driven completion path. iOS Safari never delivers `tabs.onUpdated`
 *  to the background page — not even a warm one with both host permissions on
 *  Allow (probed directly; see docs/ios-findings.md) — so the redirect can sit
 *  in its tab indefinitely with nobody watching. The popup is the one context
 *  guaranteed alive when the user comes back: on open it looks for a tab
 *  parked on the callback URL and, if one exists, hands that URL to the
 *  background over runtime messaging (which does revive the page — it is the
 *  wake path every lookup already rides). macOS keeps the `tabs.onUpdated`
 *  fast path above; this doubles as its recovery path, and `completeOAuth`'s
 *  single-use pending record makes the two racing harmless. */
export const findPendingAuthCallbackTab = async (): Promise<{ tabId: number; callbackUrl: string } | null> => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url?.startsWith(SAFARI_OAUTH_REDIRECT_URL)) {
      return { tabId: tab.id, callbackUrl: tab.url };
    }
  }
  return null;
};

/** Companion to findPendingAuthCallbackTab: the popup closes the parked tab
 *  after a successful completion. Lives here, not in sidepanel.ts, because the
 *  panel's release contract keeps every chrome.tabs touch inside this module. */
export const closeAuthCallbackTab = async (tabId: number): Promise<void> => {
  await chrome.tabs.remove(tabId).catch(() => undefined);
};
