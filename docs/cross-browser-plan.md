# Cross-Browser Support Plan (Firefox, Safari, iOS Safari)

Status: WS0/WS1/WS2/WS4 landed; WS3 (iOS) is the only open workstream — evaluated 2026-08-07
Owner: j

## Progress evaluation — 2026-08-07

Verified against the branch (not just the commit messages): `npm test` passes
(13 files, 126 tests) from this checkout, `npm run build` produces all three
targets, and per-target dead-branch elimination holds (the Safari bundles
contain zero `sidePanel`/`identity` references; Chrome and Firefox each carry
only their own panel API, in the shared `assets/auth-*.js` chunk).

| WS | Status | Notes |
| --- | --- | --- |
| WS0 foundation | ✅ done | Adapter + overlay build verified end-to-end; handoff notes below. |
| WS1 Firefox | ✅ code done | Real `sidebarAction` adapter with the sync-user-activation constraint honored and regression-tested; full manifest overlay incl. `gecko.id` and `data_collection_permissions`. `web-ext lint` is clean of errors; 2 remaining warnings are benign (the `data_collection_permissions` key isn't *recognized* until FF 140, but older Firefox ignores unknown keys). Docs: `docs/firefox.md`. Not yet done: in-browser smoke run. |
| WS2 Safari macOS | ✅ code done | Popup overlay + `resolveActivePageForPopup` handoff, popup sizing CSS, tab-based OAuth flow fully implemented but **gated off** (`supportsOAuth: false`) behind the unregistered redirect URI — sign-in is token paste until human task 1 clears. Converter output committed intent: Xcode project exists at `apple/` with macOS+iOS app/extension targets, wired to `dist/safari/` via live folder references (packages current build automatically, no resource sync step). Docs: `docs/safari.md`. Not yet done: **`apple/` is still untracked in git** — needs `git add` + commit (j's call, flagged below); in-Safari smoke run. |
| WS3 iOS | ⬜ open | Substantially de-risked by WS2 — see the rewritten section below. |
| WS4 tests/packaging/CI | ✅ done | Clean-clone `npm test` regression fixed; `scripts/package.mjs` real; CI workflow present. The README follow-up WS4 flagged (install flow depended on committed `dist/`) was resolved in `89d8a0f`: README now instructs `npm ci && npm run build:chrome` → load `dist/chrome` unpacked. |

Remaining work, in order:

1. **Commit `apple/`** (or decide not to track it). Everything under
   `apple/Are.na Connections/` is currently untracked, which means the WS2
   deliverable exists only on this machine. The project references
   `dist/safari` relatively, so it is safe to commit as-is.
2. **Manual smoke runs** — Chrome (regression), Firefox, Safari — using the
   checklist at the bottom of this doc. No agent has run a real browser yet;
   all verification so far is build/test-level.
3. **WS3 spike** (below) — now mostly *verification* rather than porting.
4. **Human tasks** (unchanged, gate OAuth-on-Safari and any distribution):
   redirect URI registration, AMO decision, Apple Developer Program.

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
(WS0, WS1, WS2, WS4 are complete — sections kept for the acceptance criteria
and as the spec the smoke runs verify against. WS3 is the live section.)

### WS0 — Browser abstraction + per-target build ✅ done

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

### WS1 — Firefox port ✅ done (smoke run pending — see docs/firefox.md)

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

### WS2 — Safari macOS port ✅ done (apple/ uncommitted; smoke run pending — see docs/safari.md)

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

### WS3 — iOS Safari extension ✅ spike done 2026-08-08

**Findings: [`docs/ios-findings.md`](ios-findings.md).** The extension builds,
installs, enables, and renders on the iOS 17.2 Simulator with no iOS-specific
code. Two UI issues found (sub-44px `.auth-remember` checkbox; vertical
centering gap in the full-height sheet) and one tradeoff surfaced: routing
Safari OAuth through GitHub Pages doubled the iOS per-site permission prompt
surface from one host to two. Signed-in paths remain untested — they need j's
account. Go/no-go on App Store submission: technically go, practically not
yet.

The original spike plan follows, for reference.

**Feasibility verdict stands: yes.** And WS2 already did the heavy lifting the
original spike assumed would be needed: the converter-generated Xcode project
at `apple/` **already contains iOS (App) and iOS (Extension) targets** wired to
`dist/safari/` by live folder references, and `docs/safari.md` has an
"iOS prep (WS3) — done now vs. deferred" section (e.g. 16px inputs to prevent
focus zoom already landed). This is now a verification spike, not a port:

1. Build the iOS app target and run it in the Simulator
   (`mcp` simulator tooling or Xcode directly; no Developer Program needed
   for Simulator).
2. Enable the extension in Simulator Safari; walk the smoke checklist
   (popup-as-sheet rendering, lookup hit/miss, token sign-in, sign-out,
   remember-me).
3. Probe the four original risk areas, which remain the real questions:

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

Spike deliverable (revised): a screenshot-backed findings doc
(`docs/ios-findings.md`) covering the smoke checklist plus the risk areas
above, any responsive/touch CSS fixes it turns up (apply them target-scoped,
the way WS2's popup sizing was done), and a go/no-go on App Store submission
effort. Prerequisite: commit `apple/` first (remaining-work item 1), so the
spike starts from a tracked baseline. Estimated size: small — WS2 consumed
most of what the original spike budgeted for.

### WS4 — Test matrix + CI packaging ✅ done (status notes below)

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

## WS0 status: done — handoff notes for WS1/WS2/WS4

Scaffolding landed on this branch. What's in place, so nobody re-derives it:

- `src/platform/index.ts` exports `platform: PlatformAdapter` (`openPanel`,
  `getRedirectURL`, `launchAuthFlow`, `supportsOAuth`), selected at build time
  by `__TARGET__` via a literal ternary (not an object map) so Rollup dead-
  branch-eliminates the other two targets' adapters out of each bundle —
  verified `dist/firefox/background/service-worker.js` contains no
  `sidePanel` reference and `dist/chrome/...` contains no `sidebarAction`.
  `src/platform/chrome.ts` is the real, working adapter. `firefox.ts` and
  `safari.ts` are stubs with `// WS1:` / `// WS2:` comments — read those
  before editing.
- `public/manifest.base.json` + `manifest.<target>.json` overlays, merged by
  `scripts/build-manifest.mjs` (`mergeManifest`/`buildManifestFor`/
  `writeMergedManifest`, dependency-free). Permissions arrays append+dedupe;
  everything else deep-merges with overlay winning. `public/manifest.json` no
  longer exists.
- `manifest.firefox.json` and `manifest.safari.json` are minimal *skeletons*
  (WS1/WS2 own the real contents — see the WS1/WS2 sections above). Known gap
  already visible via `npm run lint:firefox`: Firefox now wants
  `browser_specific_settings.gecko.data_collection_permissions`; not added
  here since the correct value is a product decision, not a build detail.
- `vite.config.ts` reads `TARGET` env (default `chrome`), builds to
  `dist/<target>/`, defines `__TARGET__`, and copies `public/icons/` +
  the merged manifest itself (`publicDir` is disabled so `manifest.*.json`
  source files never leak into `dist/`).
- `package.json` has `build`, `build:chrome`, `build:firefox`, `build:safari`,
  `dev` (chrome watch), `lint:firefox` (`web-ext lint`, added as a
  devDependency), `package` (stub — see below), `test`, `test:watch`.
- `scripts/package.mjs` is a stub that exits 0; WS4 owns the real zip-per-
  target implementation described in the WS4 section above.
- **Breaking change worth knowing about:** the repo used to ship a committed,
  prebuilt `dist/` folder (source-controlled, so `README`'s "Download ZIP →
  load unpacked" flow and `test/scaffold.test.ts` worked with zero build
  step). That folder is retired in favor of per-target `dist/<target>/`
  build output; `README.md` now points the unpacked-install instructions at
  `dist/chrome`. `test/scaffold.test.ts` and `test/sidebar-contract.test.ts`
  were updated accordingly (`public/manifest.json` reads replaced with a
  base+chrome-overlay merge; the "prebuilt distribution" test now reads the
  freshly built `dist/chrome/manifest.json`, so a **cold clone needs
  `npm run build:chrome` (or `npm run build`) before `npm test` passes that
  check**). Whether to commit a fresh prebuilt `dist/chrome/` (as the old
  root `dist/` was) is j's call — WS4's packaging work is the natural place
  to revisit this.

## WS4 status: done — test matrix, packaging, CI

- **Fixed the clean-clone `npm test` regression.** `test/scaffold.test.ts` no
  longer reads a possibly-absent `dist/chrome/manifest.json` off disk;  it now
  calls `scripts/build-manifest.mjs`'s exported `writeMergedManifest('chrome',
  <tmp dir>)` itself before asserting, then reads that. This runs the real
  merge step (not a reimplementation of it) without paying for a full
  `tsc && vite build` on every `npm test`, and without depending on whatever
  build artifact happens to be sitting in `dist/`. Verified with
  `rm -rf dist && npm test` — passes from a bare clone. (Rejected: a `pretest`
  script running the full build — correct, but adds tens of seconds to every
  local `npm test`/watch run for the sake of one assertion; and trusting a
  stale `dist/chrome/manifest.json` if present — silently passes against
  yesterday's build.)
- **`dist/` is now git-ignored** (`.gitignore`). Rationale: it's fully a build
  output now (three targets, Vite content-hashed filenames per build), so
  committing it means noisy diffs on every build and merge conflicts between
  anyone building concurrently — which was already visibly happening between
  the WS1/WS2/WS4 agents working on this branch at the same time.
  **Tradeoff, stated plainly:** README's "Download ZIP → select the
  `dist/chrome` folder" install flow depends on `dist/chrome` existing in the
  committed tree, because GitHub's "Download ZIP" packages the git tree, not
  a local build. Ignoring `dist/` breaks that flow for anyone who downloads
  the repo without building it themselves. **Recommendation:** point
  README's install instructions at a downloaded **release zip** (produced by
  `npm run package`, e.g. attached to a GitHub Release) instead of the repo's
  source ZIP — that's what this workstream's packaging script is for. `README.md`
  is outside WS4's file ownership for this pass, so it was **not** edited; this
  is a known follow-up, not a silent break — flagging it here and in the
  handoff report.
- **`scripts/package.mjs`** now builds each requested target
  (`npm run build:<target>`, so it always packages current source, never a
  stale `dist/`) and zips it to `dist/arena-connections-<target>-<version>.zip`
  (version from `package.json`). The Chrome zip's `manifest.json` has the
  `key` field stripped (Chrome Web Store rejects/ignores it in an uploaded
  package); `dist/chrome/manifest.json` on disk — what `Load unpacked` reads —
  keeps `key` untouched, since stripping happens only in a temp staging copy.
  `node scripts/package.mjs [target...]` defaults to all three. Dependency-free:
  builds shell out to the existing `npm run build:<target>` scripts, archiving
  shells out to the **system `zip` binary** (macOS/most Linux ship it; the
  script fails with a clear message up front if it's missing rather than
  producing nothing).
- **Test coverage added:** `test/platform.test.ts` (each adapter's shape
  against `PlatformAdapter`; mocked `chrome.sidePanel`/`chrome.identity` for
  Chrome and `chrome.sidebarAction`/`chrome.identity` for Firefox; a
  tripwire proving the Safari adapter never touches `chrome.sidePanel` or
  `chrome.identity`, since neither exists on Safari; the `__TARGET__`
  selection default plus a source-level guard that it stays a literal ternary
  rather than an object map, since only the literal form lets Rollup
  dead-branch-eliminate the other two targets' adapters out of each bundle;
  and, for both Chrome and Firefox, an explicit check that `openPanel` reaches
  the platform's open call **synchronously** — no `await` ahead of it — since
  both `sidePanel.open()` and `sidebarAction.open()` require still being
  inside the triggering click's user-activation window) and
  `test/build-manifest.test.ts` (deep-merge semantics, permissions
  append+dedupe, replace-not-merge for every other array, and — checked
  against the real `public/manifest.*.json` files, not just fixtures — that
  `key`/`minimum_chrome_version` land only on the Chrome manifest). Full
  bundle-level dead-code-elimination (i.e. that `chrome.sidebarAction` never
  appears anywhere in the Chrome build's output, and vice versa) is
  re-verified manually via `npm run build` + `grep`, not baked into the vitest
  suite, to keep `npm test` fast — see the Verification section of the WS4
  handoff report for that grep output.
- **CI**: `.github/workflows/ci.yml`, one job on `ubuntu-latest` with Node LTS,
  `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build` (all three
  targets), then `npm run lint:firefox`. Runs on push to `main` and on every
  pull request.

## Manual smoke checklist (per browser)

Work through this after any change that touches `src/platform/`, `src/core/auth.ts`,
`src/background/service-worker.ts`, `src/sidepanel/`, or a manifest overlay.
Repeat once per target that changed (Chrome via `dist/chrome` unpacked; Firefox
via `web-ext run --source-dir dist/firefox` or a temporary AMO install; Safari
via the Xcode project at `apple/Are.na Connections` — run `npm run build:safari`
first, since its targets reference `dist/safari/` directly).

### Chrome

- [ ] Lookup hit: click the toolbar button on a page with known Are.na
      connections; the panel opens and shows matching blocks.
- [ ] Lookup miss: click the toolbar button on a page with no connections; the
      panel shows the empty state, not an error.
- [ ] Connections expand: open a block's connections list; counts and channel
      rows load correctly, including channel visibility styling (open/closed/private).
- [ ] Sign in via OAuth: complete the `chrome.identity` flow; the panel shows
      the signed-in state afterward.
- [ ] Sign in via token paste: paste a personal access token; same signed-in result.
- [ ] Sign out: the panel returns to the signed-out state and a subsequent
      lookup no longer includes authenticated-only data.
- [ ] Remember-me persistence: sign in with "Remember device" checked, restart
      Chrome, reopen the panel — still signed in.
- [ ] Remember-me off: sign in with it unchecked, restart Chrome, reopen the
      panel — signed out again (session-only).
- [ ] Panel reopen after browser restart: quit and relaunch Chrome, click the
      toolbar button — panel opens normally, no stale state or console errors.

### Firefox

- [ ] Lookup hit and miss (as above) with the sidebar opened via
      `browser.sidebarAction.open()` from the toolbar click.
- [ ] Connections expand (as above).
- [ ] Sign in via OAuth (`identity.launchWebAuthFlow`) — confirm the Firefox
      redirect URI is registered on the Are.na OAuth app first (see "Human
      tasks for j").
- [ ] Sign in via token paste.
- [ ] Sign out.
- [ ] Remember-me persistence across a Firefox restart (verify
      `storage.session` behaves as expected on Firefox 115+).
- [ ] Panel reopen after browser restart.
- [ ] Sidebar layout: resize the sidebar narrower than Chrome's 320px minimum
      — no overflow or clipped content.

### Safari (macOS)

- [ ] Lookup hit and miss via the action popup (no sidebar on this target).
- [ ] Connections expand inside the popup without overflow or double-scroll.
- [ ] Sign in via token paste (OAuth may be gated behind `supportsOAuth` until
      WS2's tab-based flow lands — check the sign-in card reflects that).
- [ ] Sign in via OAuth, once implemented — confirm the Safari redirect is
      registered on the Are.na OAuth app first.
- [ ] Sign out.
- [ ] Remember-me persistence across a Safari restart.
- [ ] Panel (popup) reopen after browser restart.
- [ ] Popup sizing: confirm explicit width/max-height hold and the layout
      doesn't collide with Safari's own popup chrome.
