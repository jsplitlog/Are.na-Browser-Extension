# Safari (macOS + iOS) — WS2 build & run

This is the Safari-specific companion to `docs/cross-browser-plan.md`. It
covers building the Safari target, converting it to an Xcode project, how
sign-in works, and what still depends on a decision from j.

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
- `host_permissions` adds the OAuth redirect origin
  (`https://jsplitlog.github.io/arena-connections/*`) alongside
  `https://api.are.na/*` — required for `tabs.onUpdated` to reveal the
  callback URL. See the OAuth section below.
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

`apple/` **is tracked** as of 2026-08-07 — the whole generated project, which
is standard practice for this converter's output. `project.pbxproj` contains
no absolute paths, so the project works from any clone. Xcode per-user state
(`xcuserdata/`, `*.xcuserstate`, `DerivedData/`) is gitignored.

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

## OAuth: how sign-in works on Safari

Safari has no `chrome.identity` API. The replacement is a tab-based
Authorization Code + PKCE flow, implemented in `src/platform/safari.ts`:
`chrome.tabs.create` opens the Are.na authorize URL, a `chrome.tabs.onUpdated`
listener watches for the tab navigating to the registered redirect URI,
`chrome.tabs.remove` closes the tab once the callback is captured (or on
cancellation/timeout). All the PKCE/state/token-exchange logic in
`src/core/auth.ts` is unchanged and flow-agnostic — it only calls
`platform.launchAuthFlow(url)` and awaits a callback URL string, exactly like
the Chrome/Firefox `chrome.identity.launchWebAuthFlow` path.

**This is live** as of 2026-08-07, using a redirect page we publish from
`site/oauth2.html` (full rationale in "Decision: Safari OAuth runs through
GitHub Pages" below):

```ts
// src/platform/safari.ts
const SAFARI_OAUTH_REDIRECT_URL = 'https://jsplitlog.github.io/arena-connections/oauth2.html';
```

Alongside the OAuth button, the sidepanel also renders a token-paste form
(`.auth-token-form` — see `src/sidepanel/sidepanel.css`) calling the
`signInWithToken(token, remember)` export from `src/core/auth.ts` (a thin
wrapper around the token-validation code the OAuth path already used
internally). Both appear on Safari because `safariPlatform.offersTokenSignIn`
is `true`; Chrome and Firefox set it `false` and show the OAuth button alone.
The form runs entirely inside the popup page — no message round-trip to the
background — since `chrome.storage` and `fetch` to `https://api.are.na` are
both available directly from any extension page and already covered by the
CSP (`connect-src https://api.are.na`).

Users generate a personal access token at
https://www.are.na/settings/personal-access-tokens — an Are.na-supported
authentication method in its own right, listed alongside OAuth2 in their
developer docs, not a workaround. (`https://dev.are.na/oauth/applications`
is where OAuth *applications* are created — a different thing, and the wrong
link to give an end user.)

## Decision: Safari OAuth runs through GitHub Pages (2026-08-07)

Are.na offers **no hosted or out-of-band redirect** — no
`urn:ietf:wg:oauth:2.0:oob`, no copy-the-code page — so a Safari OAuth flow
needs an https callback we host. That callback is now a static, script-free
page published by GitHub Pages from `site/oauth2.html`:

```
https://jsplitlog.github.io/arena-connections/oauth2.html
```

**Status: the flow is verified working in Safari (2026-08-07)** — extension
loaded via **Develop → Add Temporary Extension…** on `dist/safari`, OAuth
completed, signed in.

It was verified *before* the page was deployed, against a GitHub 404. That is
not a fluke and is worth understanding: the watcher in
`src/platform/safari.ts` keys off the tab **navigating** to the redirect URL,
reading the code from `changeInfo.url`. Whether the server returns a page, a
404, or nothing is irrelevant to the flow — the extension closes the tab
before the response matters. So `site/oauth2.html` exists purely so users
don't watch a 404 flash past mid-sign-in. **A successful sign-in is therefore
not evidence that the page deployed** — check that separately:

```sh
curl -sI https://jsplitlog.github.io/arena-connections/oauth2.html | head -1
```

**Token paste-in stays on the sign-in card alongside the OAuth button** on
this target (`offersTokenSignIn: true` — Chrome and Firefox set it `false`).
Safari is the only target whose sign-in depends on something outside the
browser, so a Pages outage, a repo rename, or a revoked registration degrades
sign-in rather than breaking it.

### Why this is safe

Only the single-use **authorization code** ever reaches the redirect page.
Never the user's password (they authenticate on are.na), never the access
token (exchanged directly from the extension to `api.are.na`), and never the
PKCE verifier. A code without that verifier is worthless — which is exactly
what PKCE defends. The page itself loads no scripts, no fonts, and no
external resources, and sets `referrer: no-referrer` so the code cannot leak
via a `Referer` header. GitHub does not expose Pages access logs.

### The three things that must agree

Sign-in fails closed if any of these drift apart. Two live in this repo and
are covered by `test/platform.test.ts` ("safari oauth redirect contract"):

1. `SAFARI_OAUTH_REDIRECT_URL` in `src/platform/safari.ts`.
2. `host_permissions` in `public/manifest.safari.json`. **Without host access
   to that origin, `tabs.onUpdated` withholds `changeInfo.url`** and the
   flow's watcher never sees the callback — the least obvious failure mode
   here. Note `host_permissions` is replaced rather than appended by
   `scripts/build-manifest.mjs`, so the overlay restates `api.are.na` too.
3. The redirect URI registered on the Are.na OAuth application, space-
   separated onto the existing Chrome and Firefox entries (see
   `docs/firefox.md` for why a space rather than a newline).

The `.html` in the path is deliberate: GitHub Pages 301-redirects a bare
directory path to add a trailing slash, which would change `pathname` and
fail the exact `origin + pathname` comparison in `src/core/auth.ts`.

### Deploying the page

`.github/workflows/pages.yml` publishes **only** `site/` — not the repo root —
on pushes to `main` that touch it, plus `workflow_dispatch`. Enabling Pages
(Settings → Pages → Source: GitHub Actions) is a one-time repo setting.

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

## Manual smoke checklist (do this in Safari)

No agent can drive Safari, so these are j's to run. **OAuth sign-in is
confirmed working (2026-08-07)**; the rest are unrun.

### Loading the extension

The fastest loop is **not** the Xcode app. Safari 18+ loads an unpacked
extension directly:

**Develop → Add Temporary Extension…** → select the `dist/safari` *folder*
(not `manifest.json` inside it). Rebuild with `npm run build:safari` and
re-add to pick up changes.

Two setup traps, both of which present as "the extension isn't in the list at
all" rather than as an error:

- **Develop → Allow Unsigned Extensions must be on**, and it **resets every
  time Safari quits**. Unsigned extensions are hidden entirely, not shown
  disabled. (The Develop menu itself needs Settings → Advanced → *Show
  features for web developers*.)
- **Safari won't discover the container app from DerivedData.** If you want
  the Xcode route — which you'll need eventually for the iOS target — copy
  `Are.na Connections.app` to `/Applications`, launch it once from there,
  then restart Safari and re-enable Allow Unsigned Extensions.

Also note Are.na ships its *own* Safari extension named "Are.na"; ours is
"Are.na Connections". Easy to mistake one for the other in the list.

### Checklist

- [x] OAuth sign-in completes and returns to the popup signed in.
- [ ] Grant **jsplitlog.github.io** access in Safari → Settings → Extensions
      → Are.na Connections. Without it `tabs.onUpdated` withholds the
      callback URL and OAuth times out.
- [ ] Click the toolbar icon → popup opens at a reasonable size, no
      scrollbar-within-scrollbar, no clipped content.
- [ ] With no active tab context yet available: popup shows "No page
      selected" gracefully (shouldn't happen in practice since the popup
      always has an active tab, but confirm no crash if `tabs.query` returns
      no url, e.g. on a Safari internal page).
- [ ] Navigate to a page known to have Are.na connections, open the popup →
      lookup runs, results render, connections backfill.
- [ ] Sign out, open popup → both the OAuth button and the token-paste form
      appear (Safari renders both — `supportsOAuth` and `offersTokenSignIn`
      are both true), submit an invalid token → inline error, submit a valid
      token → signs in and re-runs the lookup for the last-viewed page.
- [ ] "Remember device" checkbox persists across popup close/reopen and
      Safari restart.
- [ ] Re-open the popup on a different tab → shows that tab's connections,
      not the previous tab's (validates the `tabs.query({active,
      currentWindow})` handoff in `resolveActivePageForPopup`).
- [ ] Confirm no `chrome.tabs`/`sidePanel`-shaped console errors — Safari's
      extension console (Develop menu → Web Extension Background Content)
      should be clean.
