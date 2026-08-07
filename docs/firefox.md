# Firefox port

Status: WS1 complete (per `docs/cross-browser-plan.md`). This doc covers
building, linting, running, and signing the Firefox target, plus two
decisions j needs to make/confirm.

## Build

```sh
npm run build:firefox
```

Runs `tsc --noEmit`, builds with `TARGET=firefox`, and merges
`public/manifest.base.json` + `public/manifest.firefox.json` into
`dist/firefox/manifest.json`. Output layout mirrors `dist/chrome`:
`dist/firefox/background/service-worker.js`,
`dist/firefox/sidepanel/sidepanel.html`, `dist/firefox/icons/`.

## Lint

```sh
npm run lint:firefox
```

Runs `web-ext lint --source-dir dist/firefox` (AMO's own validator, via the
`web-ext` devDependency added in WS0). Current status: **0 errors, 0
notices, 2 warnings**, both expected — see "data collection permissions"
below for why they're left as-is rather than silenced.

## Run in Firefox

```sh
npx web-ext run --source-dir dist/firefox
```

This launches a dedicated Firefox profile with the extension temporarily
installed and hot-reloads on rebuild. To load it into your normal Firefox
profile instead: `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on** → select `dist/firefox/manifest.json`. Temporary installs (either
method) are removed when Firefox closes, and the sidebar action, background
script, and icons all behave the same as a signed install.

## AMO signing

Firefox requires every extension — even ones you only distribute yourself,
never through addons.mozilla.org's public listing — to be **signed by
Mozilla** before it can be installed permanently (unsigned installs only
work as the temporary, session-only loads described above, or on Firefox
Developer/Nightly builds with signature enforcement disabled).

Two paths, both starting from the same AMO developer account
(https://addons.mozilla.org/developers/):

- **Listed**: submit to the public AMO catalog. Mozilla reviews the
  submission (automated + possibly manual), then signs it. Users can find
  and install it from addons.mozilla.org, and it auto-updates through AMO.
- **Self-distributed (unlisted)**: submit through the same developer
  account but mark the version "unlisted." Mozilla still signs it (a
  lighter automated check, not a public review), but it never appears in
  AMO search/browse. You host the signed `.xpi` yourself and distribute
  the link directly; Firefox will install and update it from that URL.

Either path needs `web-ext lint` clean (it is) before submission. **j's
decision:** listed vs. unlisted. Given the extension already has a
"download ZIP → load unpacked" distribution model for Chrome, unlisted is
the closer match — but it does mean self-hosting the signed `.xpi` and its
update manifest.

## OAuth redirect URI

`identity.getRedirectURL()` on Firefox returns a URI of the shape:

```
https://<extension-id-hash>.extensions.allizom.org/<path>
```

(`core/auth.ts` calls it as `platform.getRedirectURL('oauth2')`, so the
path segment will be `oauth2`.) The `<extension-id-hash>` is derived
deterministically from `browser_specific_settings.gecko.id`
(`arena-connections@jsplit.me`, set in `public/manifest.firefox.json`), so
it is **stable across rebuilds** as long as that gecko id doesn't change —
but it is not a value this doc can compute or guess correctly, and stating
a guessed hash as fact would be worse than not stating one.

**To read the real value:** load the built extension (temporary install or
signed), open `about:debugging#/runtime/this-firefox`, find "Are.na
Connections," click **Inspect** to open its background-script console, and
evaluate:

```js
browser.identity.getRedirectURL('oauth2')
```

That exact string is what **j must register as an additional redirect URI
on the Are.na OAuth application** (alongside the existing Chrome
`https://<id>.chromiumapp.org/oauth2` entry) before sign-in via
`signInWithOAuth` will work in Firefox. Until it's registered, Firefox
users can still sign in via manual token paste-in
(`core/auth.ts` `signInWithToken`), which doesn't depend on this at all —
so this gap does not block shipping the Firefox build.

## Data collection permissions

`public/manifest.firefox.json` sets:

```json
"browser_specific_settings": {
  "gecko": {
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

Mozilla now requires this key on all new/updated Firefox extensions
(warning `MISSING_DATA_COLLECTION_PERMISSIONS` otherwise). `"none"` is the
literal enum value `addons-linter` accepts for "collects nothing" (confirmed
by reading `node_modules/addons-linter`'s bundled schema — the
`DataCollectionPermission` type is `CommonDataCollectionPermission | "none"`,
and `required` must be a non-empty array of those). It's the honest value
here: the extension stores the user's own Are.na access token locally
(`chrome.storage.local`/`.session`) and only ever calls `api.are.na`; nothing
is collected or transmitted to us or any third party. **j should confirm
this reading is still accurate before the first AMO submission** — if that
ever changes (e.g. telemetry gets added), this value needs to change with it.

This produces two remaining `web-ext lint` warnings, both expected and left
as-is rather than "fixed":

```
KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION
KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION
```

Both say `strict_min_version: "115.0"` predates Firefox 140/Android 142,
which is when `browser_specific_settings.gecko.data_collection_permissions`
support was introduced — so a Firefox between 115 and 139 will simply
ignore the key (it doesn't break anything there, it's just invisible to
that key's own consent surface). `strict_min_version` is set to 115.0
because that's the plan's documented floor for `storage.session` support
(`docs/cross-browser-plan.md`'s portability table). Bumping the floor to
140 would silence these two warnings but exclude every user on Firefox
115–139, which is a reach-vs-cleanliness tradeoff, not a build detail —
**j's call** whether 115.0 stays or moves up. Left at 115.0 for now since
the warnings are informational only (0 errors, 0 notices).

## Manual smoke test (run in an actual Firefox — not done here)

This environment cannot launch Firefox interactively, so none of the steps
below have been run. Before relying on the Firefox build:

1. `npm run build:firefox && npx web-ext run --source-dir dist/firefox`
2. On a page not on Are.na, click the extension's toolbar button — the
   sidebar should open immediately (same click, no delay) showing either a
   lookup-in-progress state or the sign-in card.
3. Visit a URL you know is saved to an Are.na channel, click the button
   again — confirm a **lookup hit**: the matching block(s) and channel(s)
   appear.
4. Visit a URL you know is *not* saved anywhere, click the button — confirm
   a **lookup miss** renders sanely (no error, clear empty state).
5. On a hit, expand a block's **connections** — confirm the channel list
   and connection counts load.
6. Sign in via **token paste-in** (`core/auth.ts` `signInWithToken`) —
   confirmed working end to end since it doesn't depend on the redirect URI
   registration above.
7. If/when the Firefox redirect URI is registered on the Are.na OAuth app
   (see above), also try **Sign in with Are.na** (the OAuth button) and
   confirm the popup flow completes and returns to the sidebar signed in.
8. **Sign out** — confirm the token is cleared and the sidebar returns to
   the sign-in card.
9. Restart Firefox (or reload the temporary add-on) and **reopen the
   sidebar** — confirm "Remember device" persistence behaves as expected
   (signed-in state survives if it was checked, cleared if not).
