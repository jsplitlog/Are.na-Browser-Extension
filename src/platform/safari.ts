import type { PlatformAdapter } from './index';

// WS2: Safari has neither `chrome.sidePanel` nor `chrome.identity`. The plan
// is to drop the panel entirely in favor of `action.default_popup` (manifest
// overlay owns that) and to replace openPanel's active-page handoff with a
// popup-open listener that queries tabs.query({active: true, currentWindow:
// true}) instead of action.onClicked. OAuth needs the tab-based Authorization
// Code + PKCE flow (tabs.create + tabs.onUpdated watch + tabs.remove) behind
// launchAuthFlow. Until that lands, supportsOAuth stays false so the sidepanel
// UI hides the OAuth button and falls back to token paste-in (core/auth.ts
// signInWithToken), which never depends on this adapter.
export const safariPlatform: PlatformAdapter = {
  supportsOAuth: false,
  openPanel: async () => {
    // No-op: Safari opens the action popup itself; there is nothing to trigger here.
  },
  getRedirectURL: () => {
    throw new Error('Safari OAuth redirect is not implemented yet (see WS2). Use token sign-in.');
  },
  launchAuthFlow: () => {
    throw new Error('Safari OAuth flow is not implemented yet (see WS2). Use token sign-in.');
  },
};
