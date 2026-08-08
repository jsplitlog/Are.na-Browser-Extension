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

## OAuth redirect URI — registered, working

The Firefox redirect URI is:

```
https://0ad619d4912d78649cce9efc30fd890eb36ef69e.extensions.allizom.org/oauth2
```

It is registered on the Are.na OAuth application and OAuth sign-in is
confirmed working in Firefox (2026-08-07).

**The hash is `sha1(gecko.id)`, not a per-install value.** Firefox's
`identity.getRedirectURL()` is sometimes assumed to derive from the
extension's random per-profile internal UUID, which would make a single
registered URI impossible. It doesn't:

```sh
printf '%s' 'arena-connections@jsplit.me' | shasum -a 1
# 0ad619d4912d78649cce9efc30fd890eb36ef69e
```

So the URI is a pure function of
`browser_specific_settings.gecko.id` in `public/manifest.firefox.json` —
identical on every profile and machine, temporary install or signed build.
**Changing that gecko id invalidates the registration** and requires
re-registering the new hash.

The path segment comes from `OAUTH_REDIRECT_PATH` in `core/auth.ts`, which
the adapter receives via `platform.getRedirectURL('oauth2')`.

To re-read the live value at any time, load the extension, open
`about:debugging#/runtime/this-firefox`, click **Inspect** on Are.na
Connections, and evaluate `browser.identity.getRedirectURL('oauth2')`.

### Registering more than one redirect URI on Are.na

Are.na's OAuth application form has a **single-line** Redirect URI field, so
a newline-separated list can't be typed into it. Multiple URIs work anyway
when **separated by a space** — the backend splits the stored value on
whitespace, both when validating the save and when matching at authorize
time. The field currently holds, on one line:

```
https://poolkoglmiobmahcbamkbhljhgeooajm.chromiumapp.org/oauth2 https://0ad619d4912d78649cce9efc30fd890eb36ef69e.extensions.allizom.org/oauth2
```

If a future URI ever fails to save or fails to match, the fallback is a
separate Are.na OAuth application per target, which means moving
`OAUTH_CLIENT_ID` out of the shared constant in `core/auth.ts` onto the
platform adapter. Verify Chrome sign-in as well as Firefox after any edit
to this field — a value Are.na parses as one malformed URI breaks both.

Token paste-in (`core/auth.ts` `signInWithToken`) never depends on any of
this and remains the universal fallback.

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

## Manual smoke test (run in an actual Firefox)

Status: **OAuth sign-in confirmed working** (step 7) on 2026-08-07. The
remaining steps are unrun — no agent can launch Firefox interactively.

Note on loading: unsigned builds install only as a **temporary add-on** via
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
select `dist/firefox/manifest.json`. The Extensions manager's "Install
Add-on From File…" only accepts a packaged, signed `.xpi`, and greys the
manifest out. Temporary add-ons are removed when Firefox quits.

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
7. ✅ **Sign in with Are.na** (the OAuth button) — confirmed working
   2026-08-07, once the redirect URI above was registered.
8. **Sign out** — confirm the token is cleared and the sidebar returns to
   the sign-in card.
9. Restart Firefox (or reload the temporary add-on) and **reopen the
   sidebar** — confirm "Remember device" persistence behaves as expected
   (signed-in state survives if it was checked, cleared if not).
