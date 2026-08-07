# Are.na Connections

Are.na Connections is an unofficial browser extension that shows where the page
you are viewing appears on Are.na. Click the extension button to find exact URL
matches, see their originating channels and connection totals, and open any
matching block on Are.na.

Lookups happen only when you click the extension button. The extension does not
follow your browsing in the background.

## Requirements

- Chrome 116 or later, Firefox 115 or later, or Safari 17 or later
- Node.js `20.19+` or `22.12+` and npm, to build the extension
- An Are.na Premium account (the v3 search endpoint requires Premium)

## Install in Chrome

1. From this repository's **Code** menu, choose **Download ZIP**.
2. Unzip the download somewhere you will keep it.
3. In that folder, run `npm ci` and then `npm run build:chrome`.
4. Open `chrome://extensions` in Chrome.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the `dist/chrome` folder the build just created.
8. Optionally pin **Are.na Connections** from Chrome's Extensions menu.

Chrome loads the extension directly from that folder, so do not delete it after
installation. To update, pull or download the latest source, run the build
again, then click **Reload** on the extension's card.

## Install in Firefox or Safari

Firefox and Safari need a build for their own target and a different loading
step. See [docs/firefox.md](docs/firefox.md) and
[docs/safari.md](docs/safari.md).

## Connect your Are.na account

1. Click **Are.na Connections** on a normal web page. The sign-in card opens in
   the side panel.
2. Leave **Remember device** unchecked to keep your connection for the
   current browser session only. Check it to stay signed in between sessions.
3. Click **Sign in with Are.na ✶✶**.
4. Approve the read-only connection on Are.na.

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
