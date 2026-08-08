import { chromePlatform } from './chrome';
import { firefoxPlatform } from './firefox';
import { safariPlatform } from './safari';

/** Minimal per-tab shape the adapter needs from `action.onClicked` / popup handoff. */
export type PlatformTab = Pick<chrome.tabs.Tab, 'windowId' | 'url'>;

export interface PlatformAdapter {
  /** Whether this target can run an interactive OAuth flow. When false, the UI
   *  should hide the OAuth button and rely on token paste-in (see core/auth.ts). */
  readonly supportsOAuth: boolean;
  /** Whether the sign-in card also offers token paste-in. Targets whose OAuth
   *  flow depends on something outside the browser — Safari's redirect page —
   *  keep it as a always-available fallback; Chrome and Firefox redirect through
   *  the browser itself and need no second path. */
  readonly offersTokenSignIn: boolean;
  /** Opens the extension's panel/popup. Must be called synchronously within a
   *  user-gesture handler (no `await` before it) — see background/service-worker.ts. */
  openPanel(tab: PlatformTab): Promise<void>;
  /** Returns the OAuth redirect URI this target's identity flow will call back to. */
  getRedirectURL(path?: string): string;
  /** Runs the interactive OAuth authorize step and resolves with the callback URL.
   *  When `completesAuthInBackground` is true this resolves as soon as the flow is
   *  open, without a callback URL — see below. */
  launchAuthFlow(url: string): Promise<string | undefined>;
  /** True when the callback arrives as a navigation rather than as this
   *  promise's value. Such a flow must survive the page that started it being
   *  destroyed and the background being suspended, so its state is persisted
   *  (core/auth.ts) and the callback is delivered by a content script
   *  (content/oauth-callback.ts) rather than held in memory. */
  readonly completesAuthInBackground: boolean;
}

// A ternary on the literal __TARGET__ (rather than an object keyed by it) lets Rollup's
// dead-branch elimination drop the other two targets' adapters — and their unsupported-API
// calls, e.g. chrome.sidePanel.open — out of each build entirely.
export const platform: PlatformAdapter =
  __TARGET__ === 'chrome' ? chromePlatform
  : __TARGET__ === 'firefox' ? firefoxPlatform
  : safariPlatform;
