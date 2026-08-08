# Are.na Connections

Are.na Connections is an unofficial browser extension that shows where the page
you are viewing appears on Are.na. Click the extension button to find exact URL
matches, see their originating channels and connection totals, and open any
matching block on Are.na.

Lookups happen only when you click the extension button. The extension does not
follow your browsing in the background.

## Requirements

- Chrome 116 or later, Firefox 115 or later, or Safari 18 or later (the
  documented Develop → Add Temporary Extension flow; Safari 16.4–17 works via
  the Xcode route in [docs/safari.md](docs/safari.md))
- Node.js `20.19+` or `22.12+` and npm, to build the extension
- An Are.na Premium account (the v3 search endpoint requires Premium)

## Install a development build

Every browser starts the same way — get the source and build it:

1. From this repository's **Code** menu, choose **Download ZIP** (or clone it).
2. Unzip it somewhere you will keep it; the browser loads the extension from
   that folder, so don't delete it afterwards.
3. In that folder, run `npm ci`, then the build for your browser below.

How you load the result differs a lot per browser, and only Chrome is as
simple as "build and import". The short version:

| Browser | Effort | Survives a browser restart? |
| --- | --- | --- |
| Chrome | Build, load folder | Yes |
| Firefox | Build, load file | Only if signed (free, ~5 min setup) |
| Safari (macOS) | Build, needs Xcode installed | No — re-enable each launch |
| Safari (iOS) | Build, needs Xcode + Simulator | Simulator only |

### Chrome

```sh
npm run build:chrome
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist/chrome` folder.
4. Optionally pin **Are.na Connections** from the Extensions menu.

To update: rebuild, then click **Reload** on the extension's card.

### Firefox

```sh
npm run build:firefox
```

**Quick, but temporary.** Open `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → select `dist/firefox/manifest.json`. The add-on
is removed when you quit Firefox.

Note the Add-ons manager's "Install Add-on From File…" will *not* accept this —
it only takes a signed `.xpi`, and greys out `manifest.json`.

**Permanent, needs a free Mozilla account.** Release Firefox refuses to install
unsigned extensions permanently; `xpinstall.signatures.required` only works on
Developer Edition, Nightly, and ESR. The fix is unlisted signing — nothing is
published, listed, or reviewed:

1. Create an account at
   [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) and
   generate API credentials under **Manage API Keys**.
2. `export WEB_EXT_API_KEY='<JWT issuer>'` and
   `export WEB_EXT_API_SECRET='<JWT secret>'`
3. `npm run sign:firefox` — Mozilla signs it in a minute or two and a `.xpi`
   lands in `dist/`.
4. `about:addons` → gear → **Install Add-on From File…** → select that `.xpi`.

Re-signing requires a unique version: bump `version` in both `package.json` and
`public/manifest.base.json` first. Details in [docs/firefox.md](docs/firefox.md).

### Safari (macOS)

Requires **Xcode** — Safari has no "load unpacked" equivalent that works
without it.

```sh
npm run build:safari
```

1. Safari → Settings → **Advanced** → tick **Show features for web developers**.
2. **Develop** menu → **Allow Unsigned Extensions**.
3. **Develop** → **Add Temporary Extension…** → select the `dist/safari`
   *folder* (not `manifest.json` inside it).
4. Safari → Settings → **Extensions** → tick **Are.na Connections**, and grant
   it access to `api.are.na`.

**Allow Unsigned Extensions resets every time Safari quits**, and an unsigned
extension is hidden from the Extensions list entirely rather than shown as
disabled — so if it vanishes, that's why. Re-do steps 2–3.

The panel opens as a popup rather than a sidebar on Safari; that's expected.
There is also an Xcode project at `apple/` for building the container app;
see [docs/safari.md](docs/safari.md).

### Safari (iOS)

Simulator only unless you have an Apple Developer Program membership — iOS
extensions ship only inside an App Store app. Build and run the
**Are.na Connections (iOS)** scheme from `apple/`, then enable the extension in
Settings → Apps → Safari → Extensions. Steps and current limitations are in
[docs/ios-findings.md](docs/ios-findings.md). On iOS, OAuth sign-in finishes
when you **reopen the extension** after approving on Are.na — the popup
completes the exchange on open. Token paste-in also works as a fallback.

## Connect your Are.na account

1. Click **Are.na Connections** on a normal web page. The sign-in card opens in
   the side panel.
2. Leave **Remember device** unchecked to keep your connection for the
   current browser session only. Check it to stay signed in between sessions.
3. Click **Sign in with Are.na ✶✶**.
4. Approve the read-only connection on Are.na.

On Safari the card also offers an access token field. Generate one at
[are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens)
and paste it in. On iOS, after approving on Are.na, reopen the extension —
sign-in completes on open and the approval tab closes itself.

The extension can read the Are.na data available to your account, but cannot
create, edit, or delete anything. Signing out removes the saved access token
from the extension. You can fully revoke access from Are.na's
[Authorized Apps](https://www.are.na/developers/oauth/authorized) page.

Return to the page you want to check and click the extension button. The Are.na
Connections side panel will open with the matching blocks.

## Build from source

`npm run build` builds all three targets into `dist/chrome`, `dist/firefox`,
and `dist/safari`. Build one at a time with `npm run build:chrome`,
`build:firefox`, or `build:safari`.

```sh
npm ci
npm test
npm run build
```

`npm run package` writes a store-ready zip per target into `dist/`.
