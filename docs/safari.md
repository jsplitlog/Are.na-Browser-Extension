# Safari (macOS + iOS) — WS2 build & run

This is the Safari-specific companion to `docs/cross-browser-plan.md`. It
covers building the Safari target, converting it to an Xcode project, what
works today, and what's blocked on a decision from j.

## Build

```sh
npm run build:safari
```

Produces `dist/safari/` — same layout as `dist/chrome/` and `dist/firefox/`
(manifest, `background/service-worker.js`, `sidepanel/sidepanel.html` +
assets, `icons/`). `dist/safari/manifest.json` differs from the Chrome
manifest in exactly the ways Safari needs:

- No `side_panel`, `key`, or `minimum_chrome_version` (Chrome-only fields —
  `public/manifest.base.json` never had them; only `manifest.chrome.json`
  adds them, so the Safari overlay simply never introduces them).
- No `identity` permission (there's no `chrome.identity` on Safari).
- `permissions` stays at the base set (`activeTab`, `storage`) — no `tabs`
  permission was added; see "Active-page handoff" below for why `activeTab`
  is enough.
- `action.default_popup` points at the same `sidepanel/sidepanel.html` page
  Chrome and Firefox use — there is no separate popup build, it's the same
  bundle running in a different mount context (see "Popup sizing" below).
- `background.service_worker` (Safari 16.4+ supports the same service-worker
  shape Chrome uses; no event-page rewrite needed like Firefox).

## Converting to an Xcode project

Requires Xcode (checked in this environment: `xcode-select -p` →
`/Applications/Xcode.app/Contents/Developer`,
`xcrun --find safari-web-extension-converter` resolved successfully — if
either fails on your machine, install Xcode from the App Store first).

```sh
npm run build:safari
xcrun safari-web-extension-converter dist/safari \
  --project-location apple \
  --bundle-identifier me.jsplit.arena-connections \
  --swift \
  --no-open
```

This generates `apple/Are.na Connections/Are.na Connections.xcodeproj` with
four targets — `Are.na Connections (macOS)`, `Are.na Connections (iOS)`, and
their `... Extension` counterparts — because the converter was run without
`--macos-only`/`--ios-only`. Deliberately **not** passed `--copy-resources`,
so the extension's resource group in the project references `dist/safari/`
by relative path rather than a copy frozen at conversion time: every
subsequent `npm run build:safari` updates what the Xcode targets bundle
without re-running the converter. Re-run the converter only if you need to
change the bundle identifier/app name, or after upgrading Xcode changes what
the converter scaffolds (use `--rebuild-project` to update an existing
project in place instead of starting over).

The converter printed one warning, safe to ignore:

```
Warning: The following keys in your manifest.json are not supported by your
current version of Safari. ... type
```

This is `background.type: "module"`. The built `service-worker.js` uses ES
`import` (it shares a chunk with the sidepanel bundle), so this field is
required for it to load correctly — Safari 16.4+ does support module
background scripts (see the portability table in
`docs/cross-browser-plan.md`); the converter's static manifest check is just
conservative about a newer field.

**Verified in this environment:** `xcodebuild -scheme "Are.na Connections
(macOS)" -configuration Debug -destination "platform=macOS" build
CODE_SIGNING_ALLOWED=NO` → `** BUILD SUCCEEDED **` (ad-hoc signed, unsigned
build). This confirms the generated project compiles; it does not confirm
the extension runs correctly inside Safari — running/enabling/using the
extension requires the interactive Safari + System Settings flow, which this
environment cannot drive. Do the manual smoke checklist below before
shipping.

`apple/` was left **untracked** in this checkout (`git status` shows `??
apple/`) — nothing was added or committed. Before committing it, decide:
- Commit the whole generated project (simplest; standard practice for this
  converter's output), or commit only a checked-in `project.pbxproj` +
  Info.plists and regenerate `Resources`/`Assets.xcassets` via the converter
  as a build step.
- Either way, exclude `apple/**/xcuserdata/` and `apple/**/DerivedData/` (the
  build above wrote `DerivedData` outside the repo, under
  `~/Library/Developer/Xcode/DerivedData`, so none landed inside `apple/` in
  this run — but Xcode.app itself may create `xcuserdata/` on first open).

### Requirements for real distribution

- **Apple Developer Program membership** ($99/yr) is required to run the
  extension outside of a short local development window, and is required
  for any App Store distribution (macOS direct distribution outside the
  App Store is possible with a Developer ID, still requires enrollment).
- **iOS** ships only inside an App Store app — there is no side-loading path
  for end users. The wrapper app the converter generated is enough as-is (a
  near-empty container; that's the norm for Safari Web Extension iOS apps).
- This is one of the two items in `docs/cross-browser-plan.md`'s "Human
  tasks for j" list (Apple enrollment decision) — nothing here unblocks that
  decision, it's a cost/distribution tradeoff only j can make.

## OAuth: what works, what's blocked

Safari has no `chrome.identity` API. The replacement is a tab-based
Authorization Code + PKCE flow, implemented in `src/platform/safari.ts`:
`chrome.tabs.create` opens the Are.na authorize URL, a `chrome.tabs.onUpdated`
listener watches for the tab navigating to the registered redirect URI,
`chrome.tabs.remove` closes the tab once the callback is captured (or on
cancellation/timeout). All the PKCE/state/token-exchange logic in
`src/core/auth.ts` is unchanged and flow-agnostic — it only calls
`platform.launchAuthFlow(url)` and awaits a callback URL string, exactly like
the Chrome/Firefox `chrome.identity.launchWebAuthFlow` path.

**This is implemented but not wired live**, because Safari needs a stable
`https` redirect URI we control, and none exists yet:

```ts
// src/platform/safari.ts
const SAFARI_OAUTH_REDIRECT_URL = ''; // TODO(j): fill in once registered
```

Until j supplies that URI and registers it on the Are.na OAuth application
(see `docs/cross-browser-plan.md`, "Human tasks for j" #1):

- `SAFARI_OAUTH_REDIRECT_URL` stays empty. Calling `getRedirectURL()` throws
  a clear "not configured yet" error rather than returning an invented URL —
  intentionally, so nothing can silently open a fake domain during sign-in.
- `safariPlatform.supportsOAuth` stays `false`. The sidepanel
  (`src/sidepanel/sidepanel.ts`) checks `platform.supportsOAuth` and hides
  the "Sign in with Are.na ✶✶" button entirely on this target — it doesn't
  render a disabled/broken button.
- In its place, the sidepanel renders a token-paste form (new
  `.auth-token-form` — see `src/sidepanel/sidepanel.css`) calling a new
  `signInWithToken(token, remember)` export from `src/core/auth.ts` (a thin
  wrapper around the existing token-validation code the OAuth path already
  used internally). This runs entirely inside the popup page — no message
  round-trip to the background — since `chrome.storage` and `fetch` to
  `https://api.are.na` are both available directly from any extension page
  and already covered by the CSP (`connect-src https://api.are.na`).
  Users generate a personal access token at
  https://www.are.na/settings/personal-access-tokens — this is an
  Are.na-supported authentication method in its own right, listed alongside
  OAuth2 in their developer docs, not a workaround.
  (`https://dev.are.na/oauth/applications` is where OAuth *applications* are
  created — a different thing, and the wrong link to give an end user.)

## Decision: Safari OAuth is deliberately deferred (2026-08-07)

Safari ships with token paste-in only. This is a considered stop, not an
unfinished edge:

- Are.na offers **no hosted or out-of-band redirect** — no
  `urn:ietf:wg:oauth:2.0:oob`, no copy-the-code page — so there is no way to
  complete a Safari OAuth flow without hosting an https endpoint ourselves.
- Standing up and maintaining a permanent internet-facing redirect endpoint
  is a poor trade against what it buys: saving Safari users a single paste of
  a token they generate once.
- Personal access tokens are a first-class Are.na auth method, so the Safari
  sign-in path is legitimate rather than degraded.

On the security question, for the record: the tab-based flow would expose
only the **authorization code** to the redirect host — never the user's
password (they authenticate on are.na), never the access token (exchanged
directly from the extension to `api.are.na`), and never the PKCE verifier.
A code is single-use, short-lived, and worthless without that verifier, which
is exactly what PKCE defends. A minimal-exposure host would be an endpoint
returning an empty 204 with no logging, no scripts, and no external
resources. That remains available if Safari OAuth is ever wanted; the flow
below is written and waiting on one constant.

**If that decision is revisited — once there is a redirect URI:**
1. Set `SAFARI_OAUTH_REDIRECT_URL` in `src/platform/safari.ts`.
2. Flip `supportsOAuth` to `true` in the same file.
3. Rebuild — no other code changes needed; `launchAuthFlow` is already fully
   implemented (tab open/watch/close, cancel/timeout/cleanup all handled).

**Known limitation:** Safari popups are ephemeral — the browser can tear one
down if it loses focus (e.g., the user clicks elsewhere) while a request is
in flight. The token-paste request is a single `fetch` to `/v3/me`, so this
is a narrow window, but if it happens the popup just closes without saving
anything and the user re-opens it and retries; nothing is left partially
signed in.

## Popup sizing

Chrome and Firefox mount `sidepanel.html` in a resizable side panel; Safari
has no such surface, so it mounts the exact same page as `action.default_popup`,
which needs explicit dimensions instead of flowing to a resizable host.
`src/sidepanel/sidepanel.ts` adds a `popup-mode` class to `<body>`, gated on
the build-time `__TARGET__` constant so Chrome and Firefox never get it:

```ts
if (__TARGET__ === 'safari') document.body.classList.add('popup-mode');
```

`src/sidepanel/sidepanel.css` scopes the popup sizing to that class only —
the unscoped sidebar rules Chrome/Firefox use are untouched:

```css
body.popup-mode {
  max-height: 600px;
  min-height: 0;
  overflow-y: auto;
  width: 380px;
}
```

One scrolling context (`body`), so there's no double-scrollbar risk — nothing
else in the page sets its own `overflow`. `380px`/`600px` are reasonable
defaults for a macOS popup, chosen to avoid the exact `360px` value
`test/sidebar-contract.test.ts` guards against reintroducing as an unscoped
fixed width (that guard is about the *old* fixed-popup-width design; a
different value, correctly scoped to `.popup-mode`, doesn't trip it).

## iOS prep (WS3) — done now vs. deferred

Cheap, non-disruptive pieces landed alongside this popup-mode pass since they
cost nothing today and WS3 will need them:

- New token-input field: `font-size: 16px` (prevents iOS Safari zooming on
  focus) and `min-height: 44px` (touch target minimum).
- `env(safe-area-inset-*)` padding added to `body` — resolves to `0` on
  everything that doesn't define safe-area insets (all of Chrome, Firefox,
  and non-notch Safari), so it's a no-op everywhere except real notched/
  home-indicator devices.

Deliberately deferred to WS3 (broader, riskier changes to shared layout that
this workstream shouldn't take on):

- Touch-target audit of pre-existing controls (`.log-out-button`,
  `.sort-button`, the per-block row tap area, the `.auth-remember` checkbox)
  — several are likely under 44px today and weren't sized for touch.
- The `.auth-remember` checkbox itself lives in `src/styles/auth-card.css`,
  which this workstream doesn't own — any resize needs to happen there.
- A hover-affordance audit across the whole component set (spot-checked only:
  the existing `:hover` rules are decorative on top of otherwise-functional
  click targets, not hover-only affordances, so nothing found needing fixes,
  but this wasn't exhaustive).
- Verifying the OAuth tab-based flow's actual behavior on iOS Safari (the
  plan's WS3 section flags this explicitly) — blocked on the same redirect-URI
  dependency as macOS OAuth above, plus needs a real device/simulator smoke
  test this environment can't run.

## Manual smoke checklist (do this in Safari — not run here)

This environment cannot drive Safari interactively, so none of the below has
been exercised end-to-end. Before shipping:

- [ ] Build the extension in Xcode, run the macOS app target, enable the
      extension in Safari → Settings → Extensions.
- [ ] Click the toolbar icon → popup opens at a reasonable size, no
      scrollbar-within-scrollbar, no clipped content.
- [ ] With no active tab context yet available: popup shows "No page
      selected" gracefully (shouldn't happen in practice since the popup
      always has an active tab, but confirm no crash if `tabs.query` returns
      no url, e.g. on a Safari internal page).
- [ ] Navigate to a page known to have Are.na connections, open the popup →
      lookup runs, results render, connections backfill.
- [ ] Sign out, open popup → token-paste form appears (not the OAuth
      button), submit an invalid token → inline error, submit a valid token
      → signs in and re-runs the lookup for the last-viewed page.
- [ ] "Remember device" checkbox persists across popup close/reopen and
      Safari restart.
- [ ] Re-open the popup on a different tab → shows that tab's connections,
      not the previous tab's (validates the `tabs.query({active,
      currentWindow})` handoff in `resolveActivePageForPopup`).
- [ ] Confirm no `chrome.tabs`/`sidePanel`-shaped console errors — Safari's
      extension console (Develop menu → Web Extension Background Content)
      should be clean.
