# Privacy Policy for Are.na Connections

_Last updated: 2026-08-06_

Are.na Connections is a Chrome extension that shows where the page you are
viewing appears on Are.na. This policy explains what data the extension
handles and why.

## What the extension does

The extension only looks anything up when you click its toolbar button. It
does not read, monitor, or collect your browsing activity in the background.

When you click the button:

1. The extension reads the URL of the page you are currently viewing.
2. It sends a search query derived from that URL, along with your Are.na
   OAuth access token, to `api.are.na` over HTTPS.
3. Are.na returns any matching blocks, which are shown in the side panel.

## Data we handle

- **Page URL.** Sent to Are.na only at the moment you click the toolbar
  button, solely to search for matching blocks. It is not sent anywhere
  else and is not logged by the extension.
- **Are.na OAuth access token.** Obtained through Are.na's OAuth sign-in
  flow with read-only scope. It is stored in `chrome.storage.session` by
  default, so it is cleared when the browser session ends. If you check
  **Remember device**, it is stored in `chrome.storage.local` instead, so
  it persists between sessions on that device.
- **Lookup results cache.** Search results are cached locally in the
  browser, with a limited time-to-live, to avoid repeat lookups. This
  cache never leaves your device.
- **Anonymous local counters.** The extension keeps a small local count of
  lookups performed and matches found. These counters are not currently
  surfaced anywhere and never leave your device.

## What we do not do

- No analytics or telemetry.
- No third-party trackers or advertising.
- We do not sell or share your data with anyone other than Are.na, and
  only as needed to perform the lookup you requested.
- We do not use your data for any purpose other than showing you where
  the current page appears on Are.na.

## Data sent to Are.na

Data sent to `api.are.na` as part of a lookup is subject to
[Are.na's own privacy policy](https://www.are.na/privacy). Are.na
Connections is an unofficial, third-party extension and is not operated
by Are.na.

## Removing your data

- **Sign out** in the extension removes your stored access token and
  clears the local lookup cache immediately.
- **Revoke access** at Are.na's
  [Authorized Apps](https://www.are.na/developers/oauth/authorized) page
  to fully revoke the extension's access token on Are.na's side.
- Uninstalling the extension removes all locally stored data, including
  the cache and any saved token.

## Changes to this policy

If this policy changes, the "Last updated" date above will change
accordingly.

## Contact

Questions about this policy or the extension's data handling can be sent
to: `[TODO: add contact email before publishing]`
