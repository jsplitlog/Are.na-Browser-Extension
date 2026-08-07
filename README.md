# Are.na Connections

Are.na Connections is an unofficial Chrome side-panel extension that shows
where the page you are viewing appears on Are.na. Click the extension button to
find exact URL matches, see their originating channels and connection totals,
and open any matching block on Are.na.

Lookups happen only when you click the extension button. The extension does not
follow your browsing in the background.

## Requirements

- Chrome 116 or later
- An Are.na Premium account (the v3 search endpoint requires Premium)

## Install in Chrome

1. From this repository's **Code** menu, choose **Download ZIP**.
2. Unzip the download somewhere you will keep it.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the `dist/chrome` folder inside the unzipped download.
7. Optionally pin **Are.na Connections** from Chrome's Extensions menu.

Chrome loads the extension directly from that folder, so do not delete it after
installation. To update, replace the existing `dist/chrome` contents with those
from a new download, then click **Reload** on the extension's card.

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

Building is optional and only needed when changing the extension. It requires
Node.js `20.19+` or `22.12+` and npm.

```sh
npm ci
npm test
npm run build
```

Load the generated `dist/chrome` folder through the same Chrome steps above.
