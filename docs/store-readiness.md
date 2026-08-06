# Chrome Web Store readiness checklist

Are.na Connections currently ships as a load-unpacked build (the committed
`dist/`) and is not yet published to the Chrome Web Store. This checklist
covers what is left before a first store release.

## Manifest `key` and OAuth redirect

`public/manifest.json` pins a `key` field so the extension keeps a stable ID
across unpacked reloads. The Chrome Web Store **rejects uploaded packages
that contain a `key` field**, so it must be stripped from the zip before
upload. Removing it means the Store assigns a new extension ID, and that ID
changes the OAuth redirect URI the extension uses
(`chrome.identity.getRedirectURL('oauth2')` →
`https://<extension-id>.chromiumapp.org/oauth2`). If that redirect isn't
registered with Are.na before the first store release, sign-in will fail for
everyone who installs from the Store.

- [ ] Do a first draft/private upload to the dashboard (with `key` stripped)
      to reserve the permanent Store extension ID.
- [ ] Register that Store ID's `https://<id>.chromiumapp.org/oauth2`
      redirect URI with the Are.na OAuth application, alongside the existing
      unpacked-dev redirect.
- [ ] Keep `key` in the repo's `public/manifest.json` (unpacked installs need
      it for a stable ID); strip it only in the packaging step that builds
      the store zip, so it never reaches the uploaded package.
- [ ] Confirm sign-in works end-to-end from a Store-installed (or draft
      test) build before announcing the release.

## Privacy policy

- [ ] Host the policy in `PRIVACY.md` (draft included in this repo) at a
      public URL. The dashboard requires this because the extension uses
      the `identity` permission and sends data derived from the active
      page's URL to `api.are.na`.
- [ ] Fill in the contact placeholder in `PRIVACY.md` before publishing it.
- [ ] Enter the hosted URL in the dashboard's Privacy tab.

## Data-use disclosures (dashboard "Privacy practices" tab)

- [ ] Declare **website content** (the current page's URL) as data
      collected, used to search Are.na for matching blocks.
- [ ] Declare **authentication information** (the Are.na OAuth token) as
      stored, used for signing in to Are.na.
- [ ] Certify: not sold to third parties; not used for purposes unrelated
      to the extension's single purpose; not used for creditworthiness or
      lending decisions.

## Permission justifications (dashboard "Permissions" section)

- [ ] `activeTab` — reads the URL of the current tab only when the user
      clicks the toolbar icon; not used for background browsing tracking.
- [ ] `storage` — caches lookup results locally and stores the OAuth
      credential (session storage by default, local storage only if the
      user opts into "Remember device").
- [ ] `identity` — runs Are.na's OAuth sign-in via
      `chrome.identity.launchWebAuthFlow`.
- [ ] `sidePanel` — hosts the extension's entire UI.
- [ ] Host permission `https://api.are.na/*` — the only origin the
      extension calls, for all Are.na API requests (search, account info,
      OAuth token exchange).

## Listing content

- [ ] Disclose in the listing description that an **Are.na Premium
      account** is required (the v3 search endpoint the extension relies
      on requires Premium).
- [ ] Add reviewer test credentials (an Are.na Premium account) in the
      submission's review notes so reviewers can exercise sign-in and
      search.
- [ ] Prepare screenshots and a promo image showing the side panel with
      real results.
- [ ] Write a single-purpose description: showing where the current page
      appears on Are.na.

## Housekeeping

- [ ] Choose and add a `LICENSE` file — no license is currently committed;
      this is the repo owner's call to make before a public store listing.
- [ ] Once the Store listing exists, update the README's "Install in
      Chrome" section to link the listing (keep the unpacked instructions
      as a secondary/dev path if desired).
- [ ] The committed `dist/` in this repo stays as-is for unpacked installs;
      build the Store upload zip fresh from `npm run build` (with `key`
      stripped, per above) rather than reusing the committed `dist/`.
