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

/** Exact origin+pathname test — the callback carries ?code=&state= on top of
 *  the redirect, but nothing beyond the path may vary. A plain startsWith
 *  would also match lookalike paths (…/oauth2.htmlfoo) and let any page get
 *  arbitrary tabs closed by navigating them near the redirect URL. */
const isAuthCallbackUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}` === SAFARI_OAUTH_REDIRECT_URL;
  } catch {
    return false;
  }
};

export const safariPlatform: PlatformAdapter = {
  supportsOAuth: true,
  // OAuth is verified end to end on macOS and iOS, so the token paste-in is
  // retired from the card (j's call, 2026-08-08). The rendering path and
  // signInWithToken stay behind this flag: if the hosted redirect page ever
  // breaks (Pages outage, repo rename), flipping this back restores a
  // working sign-in without shipping new code.
  offersTokenSignIn: false,
  openPanel: async () => {
    // No-op: Safari opens the action popup itself; there is nothing to trigger here.
  },
  getRedirectURL: () => SAFARI_OAUTH_REDIRECT_URL,
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
    // The event's own tabId identifies the auth tab, so nothing has to be
    // remembered across the suspension to close it afterwards.
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!isAuthCallbackUrl(changeInfo.url)) return;
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
 *  fast path above; this doubles as its recovery path, and core/auth.ts
 *  serializes completions so the two paths racing cannot double-spend the
 *  single-use pending record. */
export const findPendingAuthCallbackTabs = async (): Promise<Array<{ tabId: number; callbackUrl: string }>> => {
  const tabs = await chrome.tabs.query({});
  return tabs.flatMap((tab) =>
    tab.id !== undefined && isAuthCallbackUrl(tab.url)
      ? [{ tabId: tab.id, callbackUrl: tab.url }]
      : []);
};

/** Companion to findPendingAuthCallbackTabs: the popup sweeps every parked
 *  callback tab once a completion attempt has run — the matched tab's code is
 *  consumed either way, and unmatched ones are dead ends from abandoned
 *  attempts that would otherwise pile up. Lives here, not in sidepanel.ts,
 *  because the panel's release contract keeps every chrome.tabs touch inside
 *  this module. */
export const closeAuthCallbackTabs = async (tabIds: number[]): Promise<void> => {
  await Promise.all(tabIds.map((tabId) => chrome.tabs.remove(tabId).catch(() => undefined)));
};
