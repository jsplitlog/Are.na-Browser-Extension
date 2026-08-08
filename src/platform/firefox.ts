import type { PlatformAdapter } from './index';

// Firefox has no `chrome.sidePanel`; the equivalent is `sidebarAction`, which
// @types/chrome does not model. Minimal local shape for the one method we need.
interface FirefoxSidebarAction {
  open(): Promise<void>;
}

const sidebarAction = (): FirefoxSidebarAction =>
  (chrome as unknown as { sidebarAction: FirefoxSidebarAction }).sidebarAction;

// Firefox promise-based chrome.* covers identity the same as Chrome (see the
// plan's portability table), so only openPanel differs from src/platform/chrome.ts.
export const firefoxPlatform: PlatformAdapter = {
  supportsOAuth: true,
  offersTokenSignIn: false,
  // background/service-worker.ts calls platform.openPanel(tab) directly out of
  // the action.onClicked listener, with no `await` ahead of it, so the call
  // still runs inside the click's user-activation window. Firefox enforces
  // that requirement more strictly than Chrome: sidebarAction.open() throws
  // unless it is reached synchronously from the gesture, so this stays a
  // plain (non-async) arrow returning the call's own promise directly —
  // no `await` or other promise hop runs ahead of it.
  openPanel: () => sidebarAction().open(),
  getRedirectURL: (path) => chrome.identity.getRedirectURL(path),
  launchAuthFlow: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  // As on Chrome: identity resolves the callback in-process.
  completesAuthInBackground: false,
};
