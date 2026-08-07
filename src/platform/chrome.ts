import type { PlatformAdapter } from './index';

/** Today's (and Chrome's) behavior: chrome.sidePanel + chrome.identity, unchanged. */
export const chromePlatform: PlatformAdapter = {
  supportsOAuth: true,
  openPanel: async (tab) => {
    if (tab.windowId === undefined) return;
    await chrome.sidePanel.open({ windowId: tab.windowId });
  },
  getRedirectURL: (path) => chrome.identity.getRedirectURL(path),
  launchAuthFlow: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
};
