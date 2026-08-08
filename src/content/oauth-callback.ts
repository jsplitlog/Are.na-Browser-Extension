// Runs only on the OAuth redirect page (see manifest.safari.json's
// content_scripts). Safari has no chrome.identity, so the callback comes back
// as a real navigation; this hands the resulting URL to the background, which
// finishes the PKCE exchange in core/auth.ts's completeOAuth.
//
// Why a content script rather than tabs.onUpdated: on iOS the popup sheet is
// dismissed the moment the auth tab opens, and the background page is then
// suspended. A tabs event does not reliably revive it — a content script
// injection does, because delivering runtime.sendMessage requires a running
// background. This is also why the flow's state lives in session storage
// instead of a closure.
import type { Request } from '../core/messages';

// The exchange needs the query string, and nothing else here does — the
// background validates state and origin before trusting any of it.
void chrome.runtime.sendMessage({ kind: 'oauthCallback', url: location.href } satisfies Request);
