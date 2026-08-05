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
6. Select the `dist` folder inside the unzipped download.
7. Optionally pin **Are.na Connections** from Chrome's Extensions menu.

Chrome loads the extension directly from that folder, so do not delete it after
installation. To update, replace the existing `dist` contents with those from a
new download, then click **Reload** on the extension's card.

## Connect your Are.na account

The extension signs in with a personal access token (PAT).

1. Sign in to Are.na and open
   [Personal Access Tokens](https://www.are.na/developers/personal-access-tokens).
2. Under **Create token**, enter a descriptive name such as
   `Are.na Connections`.
3. Choose an expiration and the least-privileged access level that permits API
   reading, then click **Create token**.
4. Copy the generated token. Treat it like a password: Are.na warns that PATs
   can grant broad access to your account. Do not share it or commit it to this
   repository.
5. Click the extension button on a normal web page, then choose **Open settings**.
   You can also open **Details → Extension options** from
   `chrome://extensions`.
6. Paste the token into **Personal access token**.
7. Leave **Remember on this device** unchecked to keep the token for the current
   browser session only. Check it to keep the token in Chrome's local extension
   storage between sessions.
8. Click **Sign in with token**. A successful connection displays
   `Signed in as your-username`.

Return to the page you want to check and click the extension button. The Are.na
Connections side panel will open with the matching blocks.

Signing out removes the saved token from the extension. To revoke it completely,
delete the token from Are.na's Personal Access Tokens page.

## Build from source

Building is optional and only needed when changing the extension. It requires
Node.js `20.19+` or `22.12+` and npm.

```sh
npm ci
npm test
npm run build
```

Load the generated `dist` folder through the same Chrome steps above.
