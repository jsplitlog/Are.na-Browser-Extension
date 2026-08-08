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

For an install that **survives quitting Firefox**, see "Getting a signed
.xpi that persists" below — signing is the only way to do it on release
Firefox.

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

Either path needs `web-ext lint` clean (it is) before submission.
**Decision: unlisted** — the goal is a build that survives a Firefox
restart, not a public listing.

### Getting a signed .xpi that persists

Signing is the *only* way to install permanently on release Firefox.
`xpinstall.signatures.required=false` in `about:config` is ignored there; it
works only on Developer Edition, Nightly, and ESR.

1. Create a free account at https://addons.mozilla.org/developers/ (no
   review, no public listing for unlisted submissions).
2. Generate API credentials: Developer Hub → **Manage API Keys** → issue a
   JWT issuer and secret.
3. Export them — **never commit these; they are account credentials**:

   ```sh
   export WEB_EXT_API_KEY='user:12345678:123'
   export WEB_EXT_API_SECRET='...'
   ```

4. Build, sign, and collect the artifact:

   ```sh
   npm run sign:firefox
   ```

   That runs `web-ext sign --channel unlisted`, which uploads
   `dist/firefox`, waits for Mozilla's automated validation (usually a
   minute or two), and drops the signed `.xpi` in `dist/`.

5. Install it: open `about:addons` → gear → **Install Add-on From File…** →
   select the signed `.xpi`. This is the same dialog that rejected the raw
   `manifest.json` earlier — it wants exactly this artifact. The add-on now
   survives restarts.

Notes:

- **Every signed upload needs a unique version.** Re-signing `0.2.0` is
  rejected; bump `version` in `package.json` *and* `public/manifest.base.json`
  (they must agree) before re-signing.
- Signing depends on `browser_specific_settings.gecko.id` being stable —
  which is also what pins the OAuth redirect URI below. Changing it breaks
  both.
- Auto-updates for a self-hosted `.xpi` need an `update_url` and a hosted
  update manifest. Without one, updating means re-installing the new file by
  hand. Fine for personal use; worth adding if others start using it.

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
https://poolkoglmiobmahcbamkbhljhgeooajm.chromiumapp.org/oauth2 https://0ad619d4912d78649cce9efc30fd890eb36ef69e.extensions.allizom.org/oauth2 https://jsplitlog.github.io/arena-connections/oauth2.html
```

(The third entry is Safari's hosted redirect, registered 2026-08-07 — see
docs/safari.md.)

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

## Manual smoke test — passed 2026-08-08

Run against the **signed unlisted build** installed from `.xpi` (not a
temporary add-on), in release Firefox.

- [x] Installs permanently and **survives quitting Firefox** — no
      `about:debugging`, no Allow Unsigned Extensions.
- [x] Toolbar button opens the sidebar on the same click (the
      user-activation constraint `sidebarAction.open()` imposes — see
      `src/platform/firefox.ts`).
- [x] **Sign in with Are.na** (OAuth) — works on the signed build with the
      same redirect URI as the temporary install, confirming the URI follows
      the gecko id rather than the install method.
- [x] Lookup hit: matching blocks and channels render.
- [x] Lookup miss: clean empty state, no error.
- [x] Connections expand: channel list and counts load.
- [x] Sign out returns the sign-in card; "Remember device" persistence
      behaves across a restart.

### Known cosmetic issue: very narrow sidebar

Firefox's sidebar resizes **below Chrome's 320px minimum**, so the layout
reaches widths it was never designed for. At the narrowest setting it looks
awkward — ordinary responsive crowding, nothing clipped, broken, or
unreadable. Observed and accepted 2026-08-08; recorded here so it isn't
re-reported as a bug. Worth a look only if the sidebar layout gets revisited
(see `docs/ui-refresh-plan.md`).

### Re-running this later

To rebuild and re-sign after changes (bump `version` in both `package.json`
and `public/manifest.base.json` first — AMO rejects a version it has already
signed):

```sh
npm run sign:firefox   # with WEB_EXT_API_KEY / WEB_EXT_API_SECRET exported
```

For a quick throwaway check without signing, a temporary add-on is still
fine: `npx web-ext run --source-dir dist/firefox`, or
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
`dist/firefox/manifest.json`. Note the Extensions manager's "Install Add-on
From File…" only accepts a signed `.xpi` and greys out `manifest.json`.
