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
- Node.js `20.19+` or `22.12+`
- npm

## Install in Chrome

1. Clone this repository and build the extension:

   ```sh
   git clone https://github.com/jsplitlog/Are.na-Browser-Extension.git
   cd Are.na-Browser-Extension
   npm ci
   npm run build
   ```

2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the generated `dist` folder inside this repository.
6. Optionally pin **Are.na Connections** from Chrome's Extensions menu.

After pulling an update, run `npm ci` and `npm run build` again, then click
**Reload** on the extension's card in `chrome://extensions`.

## Connect your Are.na account

The development build signs in with a personal access token (PAT).

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

## Verify a local build

```sh
npm test
npm run build
```
