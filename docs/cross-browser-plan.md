# Cross-Browser Support Plan (Firefox, Safari, iOS Safari)

Status: draft for subagent execution — 2026-08-07
Owner: j

## Current state (verified against the repo)

The extension is Chrome MV3 with a deliberately small browser-API surface. Every
`chrome.*` call in `src/`:

| API | Where | Chrome | Firefox | Safari (mac) | Safari (iOS) |
| --- | --- | --- | --- | --- | --- |
| `storage.local` / `storage.session` / `storage.onChanged` | `core/auth.ts`, `core/cache.ts`, `core/settings.ts`, `core/active-page.ts` | ✅ | ✅ (session: FF 115+) | ✅ (session: 16.4+) | ✅ (16.4+) |
| `runtime.sendMessage` / `runtime.onMessage` | `core/messages.ts`, `background/service-worker.ts`, sidepanel | ✅ | ✅ | ✅ | ✅ |
| `action.onClicked` | `background/service-worker.ts:77` | ✅ | ✅ | ✅ | ✅ (limited — see WS3) |
| `sidePanel.open` | `background/service-worker.ts:89` | ✅ | ❌ → `sidebarAction` | ❌ → popup | ❌ → popup |
| `identity.getRedirectURL` / `identity.launchWebAuthFlow` | `core/auth.ts:143,164` | ✅ | ✅ | ❌ → tab-based flow | ❌ → tab-based flow |
| `background.service_worker` (manifest) | `public/manifest.json` | ✅ | ❌ → `background.scripts` event page | ✅ (16.4+) | ✅ (16.4+) |

Other portability notes:

- Firefox and Safari both support **promises on the `chrome.*` namespace** in
  MV3, so the existing `await chrome.storage…` style works everywhere. No
  `webextension-polyfill` needed; the `return true` + `sendResponse` pattern in
  the message listener also works in all three.
- Manifest fields `key` and `minimum_chrome_version` are Chrome-only. Firefox
  additionally **requires** `browser_specific_settings.gecko.id` (and should set
  `strict_min_version: "115.0"` for `storage.session`).
- The CSP and `host_permissions` (`https://api.are.na/*`) are fine as-is on all
  targets.
- Tests (`test/`) run in vitest with mocked `chrome`; the abstraction layer in
  WS0 will make those mocks thinner, not thicker.

## Two real problems

Everything else is manifest plumbing. The actual engineering is:

1. **Panel surface.** Chrome uses `chrome.sidePanel`. Firefox has an equivalent
   (`sidebar_action` + `sidebarAction.open()`, callable from a user gesture like
   `action.onClicked`). Safari has *no* sidebar API — the UI must also work as
   an **action popup**, which on iOS renders as a near-fullscreen sheet. The
   sidepanel HTML/CSS/TS is already a self-contained page, so this is mostly a
   mount-context question (sizing, scroll, close-on-navigate behavior), not a
   rewrite.
2. **OAuth.** `identity.launchWebAuthFlow` doesn't exist in Safari. The
   fallback is a tab-based Authorization Code + PKCE flow: open the authorize
   URL in a tab, watch `tabs.onUpdated` for the registered redirect URI,
   extract the code, close the tab. All the PKCE/state/exchange logic in
   `core/auth.ts` is already flow-agnostic — only the "get me the callback
   URL" step needs a second implementation. **Human dependency:** each browser
   has a different redirect URI (Chrome `https://<id>.chromiumapp.org/…`,
   Firefox `https://<hash>.extensions.allizom.org/…`, Safari needs a stable
   https URL we control or an are.na-hosted redirect), and each must be
   registered on the Are.na OAuth application by j. Manual token paste-in
   (`core/auth.ts` `signInWithToken`) already exists as the universal fallback,
   so OAuth gaps never block shipping.

## Workstreams

Dependency graph: WS0 → (WS1 ∥ WS2) → WS3; WS4 runs alongside WS1/WS2.

### WS0 — Browser abstraction + per-target build (foundation, do first)

Goal: one `npm run build:<target>` per browser, zero `chrome.sidePanel` /
`chrome.identity` calls outside an adapter module.

- Create `src/platform/` with a small capability interface, e.g.
  `openPanel(tab)`, `getRedirectURL()`, `launchAuthFlow(url)`, plus a
  `TARGET` build constant (Vite `define`). Keep it minimal — do not wrap
  storage/runtime, which are already portable.
- Split `public/manifest.json` into a base + per-target overlay
  (`manifest.chrome.json`, `manifest.firefox.json`, `manifest.safari.json`),
  merged by a small build script. Overlays own: `background` shape,
  `side_panel` vs `sidebar_action` vs `action.default_popup`, `key`,
  `minimum_chrome_version`, `browser_specific_settings`.
- Vite: parameterize `outDir` to `dist/<target>` and inputs (Firefox needs a
  background entry that is a script, not a worker; same source file should
  compile for both — keep top-level code worker-safe, no `window`).
- Update `package.json` scripts: `build:chrome`, `build:firefox`,
  `build:safari`, `build` = all three. Keep `dist/` layout Chrome-compatible
  so existing local installs don't break.
- Acceptance: Chrome build from `dist/chrome` behaves identically to today;
  `grep -rn "chrome\.\(sidePanel\|identity\)" src --include='*.ts'` only hits
  `src/platform/`; all vitest suites pass.

### WS1 — Firefox port (after WS0)

- Manifest overlay: `background: { scripts: [...], type: "module" }`,
  `sidebar_action` (default_panel = the same sidepanel HTML, default_icon,
  `open_at_install: false`), `browser_specific_settings.gecko.id`
  (suggest `arena-connections@jsplit.me`), `strict_min_version: "115.0"`.
- Platform adapter: `openPanel` → `browser.sidebarAction.open()` (must run
  synchronously inside the `action.onClicked` gesture — mirror the existing
  ordering comment at `background/service-worker.ts:85`); auth uses
  `identity.launchWebAuthFlow` as on Chrome.
- Verify: sidepanel CSS in Firefox's sidebar (it's resizable and can be
  narrower than Chrome's 320px minimum); `storage.session` availability;
  the storage-observer handoff for active-page state.
- Tooling: add `web-ext lint` and `web-ext run` scripts; document AMO
  signing (even self-distributed builds require signing).
- Acceptance: `web-ext lint` clean; manual smoke test of lookup → connections
  → sign-in (token paste at minimum) in Firefox; note the Firefox redirect URI
  for j to register on the Are.na OAuth app.

### WS2 — Safari macOS port (after WS0)

- Manifest overlay: drop `side_panel`, `key`, `minimum_chrome_version`; add
  `action.default_popup: "sidepanel/sidepanel.html"`. Remove the
  `action.onClicked` open-panel path on this target (popup supersedes it) but
  keep the active-page handoff: on popup open, query `tabs.query({active:
  true, currentWindow: true})` — requires adding `"tabs"` or relying on
  `activeTab` — and write the same `ACTIVE_PAGE_KEY` session record so the
  page code is unchanged.
- Popup sizing pass on the sidepanel page: explicit `width`/`max-height` for
  popup context (target-scoped body class), keep the sidebar layout intact
  for Chrome/Firefox.
- OAuth: implement the tab-based flow in the platform adapter
  (`tabs.create` + `tabs.onUpdated` watch + `tabs.remove`), behind the same
  `launchAuthFlow(url)` interface. If redirect registration isn't ready, ship
  with token paste-in only and hide the OAuth button via a capability flag.
- Packaging: run `xcrun safari-web-extension-converter dist/safari` once,
  commit the generated Xcode project under `apple/` with macOS + iOS targets;
  document the build/run steps (requires Xcode; distribution requires Apple
  Developer Program).
- Acceptance: extension loads in Safari 17+ via Xcode run; lookup and
  connections work; sign-in works via token paste; popup layout doesn't
  overflow or double-scroll.

### WS3 — iOS Safari extension (evaluation + spike, after WS2)

**Feasibility verdict: yes, and cheaply — same codebase, same converter
output.** Safari Web Extensions run on iOS 15+; everything this extension
needs (`storage` incl. `session` on 16.4+, `runtime` messaging, `action`,
`fetch` to api.are.na, non-persistent background) is supported. What changes:

- **Distribution:** iOS extensions ship only inside an App Store app —
  Apple Developer Program ($99/yr) and App Review are hard requirements.
  The wrapper app can be a near-empty "how to enable" screen (that's the
  norm), sharing the Xcode project from WS2 as an iOS target.
- **UI:** the popup presents as a sheet/overlay at device width. The
  sidepanel page needs a responsive pass: touch targets ≥44px, no
  hover-dependent affordances, safe-area insets, `font-size ≥16px` on inputs
  to prevent zoom.
- **Lifecycle:** iOS kills the background page aggressively. The in-memory
  maps in `background/service-worker.ts` (`lookups`, `connections`) are
  fine (they're dedupe caches; `core/cache.ts` already persists to
  storage), but the spike should confirm a lookup survives a mid-flight
  background termination gracefully (worst case: user retaps).
- **OAuth:** the WS2 tab-based flow works on iOS (`tabs` API is supported);
  verify the flow returns the user to the extension popup sanely, else lean
  on token paste.
- **Per-site permissions:** iOS Safari prompts per-domain; with only
  `activeTab` + `api.are.na` host permission the prompt surface is small —
  verify the first-run experience.

Spike deliverable: iOS target running in Simulator (converter output from
WS2), a 1-page findings doc on the four risk areas above, and a go/no-go
on App Store submission effort. Estimated spike size: small — most work is
the WS2 popup mode.

### WS4 — Test matrix + CI packaging (parallel with WS1/WS2)

- Extend vitest coverage for the platform adapters (mock per-target APIs;
  `test/sidebar-contract.test.ts` is the pattern to follow).
- Add a packaging script producing store-ready zips per target
  (`dist/arena-connections-<target>-<version>.zip`), excluding the Chrome
  `key` from store builds.
- CI (if/when added): build all three targets + `web-ext lint` on every push.
- Keep a manual smoke checklist in this doc: lookup hit/miss, connections
  expand, sign-in (OAuth + token), sign-out, remember-me persistence,
  panel reopen after browser restart.

## Human tasks for j (not delegable to subagents)

1. Register per-browser redirect URIs on the Are.na OAuth application (Chrome
   ID-based URI already registered; Firefox and Safari URIs come out of
   WS1/WS2).
2. Firefox: create AMO account / decide listed vs self-distributed signing.
3. Apple: Developer Program enrollment decision (gates WS2 distribution and
   all of WS3 beyond the Simulator).
