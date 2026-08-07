import type { PlatformAdapter } from './index';

// Firefox has no `chrome.sidePanel`; the equivalent is `sidebarAction`, which
// @types/chrome does not model. Minimal local shape for the one method we need.
interface FirefoxSidebarAction {
  open(): Promise<void>;
}

const sidebarAction = (): FirefoxSidebarAction =>
  (chrome as unknown as { sidebarAction: FirefoxSidebarAction }).sidebarAction;

// WS1: this is a plausible starting point, not a finished adapter. Firefox
// promise-based chrome.* covers identity the same as Chrome (see the plan's
// portability table), so only openPanel differs. Confirm:
//  - sidebarAction.open() actually fires synchronously inside the
//    action.onClicked gesture (mirror the ordering comment in
//    background/service-worker.ts) — Firefox has historically been stricter
//    about this than Chrome.
//  - manifest.firefox.json's sidebar_action/open_at_install wiring matches.
export const firefoxPlatform: PlatformAdapter = {
  supportsOAuth: true,
  openPanel: async () => {
    await sidebarAction().open();
  },
  getRedirectURL: (path) => chrome.identity.getRedirectURL(path),
  launchAuthFlow: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
};
