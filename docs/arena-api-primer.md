# Are.na API — primer for a new project

Handoff notes written for an agent starting a fresh Are.na app (no shared code
with this repo). Everything here was learned building **✶✶ Reader**, a
zero-dependency static web client on the v3 REST API.

Each claim is tagged:

- **[verified]** — exercised against the live API in this project.
- **[docs]** — stated by Are.na's own docs/spec or first-party clients, not
  independently re-tested here.
- **[untested]** — reasonable inference; confirm before relying on it.

---

## 1. What Are.na is

Are.na is a small, ad-free platform for collecting and connecting things on the
internet. The data model is deliberately tiny, and understanding it explains
almost every API shape you'll meet.

| Concept | What it is |
| --- | --- |
| **Block** | The atom. A saved link, image, text note, embed, or uploaded file. Has an id, optional title/description, a `user` (who created it), and timestamps. |
| **Channel** | A collection of blocks. Has a title, a `slug`, an `owner`, and a status (`public` / `closed` / `private`). Channels can also contain other channels. |
| **Connection** | The join between a block and a channel. **Many-to-many**: the *same* block can live in dozens of channels, connected by different people at different times. |
| **User** | Has `name`, `slug`, `avatar`. Users follow other users and channels. |
| **Group** | Shared-membership container for channels. Rarely needed. |

Two consequences that trip people up:

1. **A block has no single "home" channel.** Anything showing "which channel is
   this in?" is a choice you make, not a field you read. (See §5, connections.)
2. **A block comes into existence by being connected.** So the *oldest*
   connection is, by construction, the channel its creator first put it in —
   the closest thing to a canonical home. **[verified]**

Canonical web URLs, useful for linking out:

```
https://www.are.na/{user_slug}                  # profile
https://www.are.na/{user_slug}/{channel_slug}   # channel
https://www.are.na/block/{block_id}             # block
```

**[verified]** — `/channel/{slug}` also resolves if you don't have the owner
slug, but it's the degraded form.

---

## 2. Which API version to use

There are two live APIs and the internet is full of stale examples. Get this
right before writing any code.

- **v2** — `https://api.are.na/v2`. The long-standing public API. Almost every
  blog post, gist, and library you'll find targets it. Still up. **[docs]**
- **v3** — `https://api.are.na/v3`. The current one: OpenAPI-specified, OAuth
  2.0, documented rate-limit headers, consistent `{ data, meta }` envelopes.
  This project used v3 exclusively. **[verified]**

**Use v3.** But be aware the two differ in response shape, parameter names, and
sort vocabulary, so **do not paste v2 snippets into a v3 client** — they fail in
subtle ways (silently ignored params, differently-named fields) rather than
loudly.

### Get the spec, don't trust memory (including mine)

The live spec is fetchable and is the tiebreaker for every question below:

```
https://api.are.na/v3/openapi.json
```

**[verified]** — this project resolved a real bug by reading it. Mirrors and
supporting docs live on GitHub under [`aredotna`](https://github.com/aredotna):

| Repo | Why you care |
| --- | --- |
| `aredotna/sdk` | `spec/openapi.json` (v3 spec: endpoints, security schemes, rate limits) and `packages/sdk/README.md` (the OAuth + PKCE guide). |
| `aredotna/api-examples` | The `explorer` example is a browser SPA doing OAuth exactly like a client-side app should. |
| `aredotna/cli` | `src/lib/oauth.ts` — first-party public-client OAuth, a good reference implementation. |
| `aredotna/mcp` | The hosted MCP server; shows redirect-URI conventions. |

These back dev.are.na and are the most reliable source available.

---

## 3. Authentication

### Two token types, one header

- **Personal access token (PAT)** — created by hand at
  [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).
  Perfect for prototyping and personal tools.
- **OAuth 2.0 access token** — issued by the authorization flow below.

They are **interchangeable bearer tokens** to the API. Build against a PAT
first, add OAuth later without touching your request layer. **[verified]**

```http
Authorization: Bearer <token>
Accept: application/json
```

### Tokens never expire

> "Access tokens do not expire and can be used indefinitely." **[docs]**

This is the single most important security fact about Are.na.

- The token response carries **no refresh token**, and there's nothing to
  refresh. **[verified]**
- There is **no revocation endpoint** in the v3 spec. Signing out is local-only;
  full revocation means the user deleting the app/token in Are.na settings.
  Say so in your UI. **[verified]**
- Treat a leaked token as a permanent credential. Are.na's own first-party
  clients agree: the CLI writes its token to disk mode `0600`; the browser
  explorer keeps it in `sessionStorage`. **[docs]**

### OAuth 2.0 — Authorization Code + PKCE

Supported flows: Authorization Code, **Authorization Code + PKCE**, and Client
Credentials. **[docs]** For anything without a trusted backend (SPA, browser
extension, CLI, desktop app) you are a **public client** → PKCE, no secret.

```
Authorize:  https://www.are.na/oauth/authorize
Token:      https://api.are.na/v3/oauth/token
Register:   https://www.are.na/developers/oauth/applications
Scopes:     read (default, read-only) | write (full read/write)
```

**[verified]** — the whole flow, end to end, in a browser.

Working implementation (this is the entire protocol; ~120 lines in
[`oauth.js`](../oauth.js)):

```js
// 1. PKCE pair — 32 random bytes, base64url; challenge = base64url(SHA-256(verifier))
const verifier  = base64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = base64url(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
// stash verifier + state in sessionStorage — they're transient transaction values

// 2. Redirect to authorize
const params = new URLSearchParams({
  client_id, redirect_uri, response_type: 'code', scope: 'read',
  state, code_challenge: challenge, code_challenge_method: 'S256',
});
location.assign(`https://www.are.na/oauth/authorize?${params}`);

// 3. On callback: validate `state` matches, then exchange — form-encoded POST, no secret
const res = await fetch('https://api.are.na/v3/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id, redirect_uri, code, code_verifier: verifier,
  }),
});
const { access_token } = await res.json();   // + token_type, optional scope. No refresh_token.
```

Rules learned the hard way:

- **Redirect URI must match the registration exactly** — scheme, host, port,
  path, trailing slash. **[docs]**
- **Register `127.0.0.1`, not `localhost`**, for local dev. Both first-party
  Are.na clients use the numeric form, and loopback HTTP redirects are accepted
  per RFC 8252 (the MCP server registers `http://127.0.0.1:8787/callback`). **[docs]**
- **Client IDs are committable.** The Are.na CLI hardcodes its default
  `client_id` in source. That's the sanctioned public-client pattern — don't
  contort your build to hide it. **[docs]**
- **Validate `state`**, and strip `?code=…&state=…` from the URL/history
  *immediately* on callback so the one-time code doesn't linger in history or
  referrers. **[verified]**
- **Secure context required** — `crypto.subtle` is unavailable on plain
  `http://` (127.0.0.1 counts as secure). Gate your sign-in button on
  `window.isSecureContext && crypto?.subtle` and explain rather than showing a
  dead button. **[verified]**
- **Ask for `read` unless you write.** Widening to `write` later costs users one
  re-consent redirect — cheap. **[verified]**
- **CORS works.** The v3 API and its token endpoint are callable directly from
  browser JS with an `Authorization` header; no proxy needed. **[verified]**

### Notes for a browser extension **[untested here]**

This project was a web page, so the following is adaptation guidance, not
verified fact — confirm as you go:

- Use `chrome.identity.launchWebAuthFlow` with
  `chrome.identity.getRedirectURL()`, which yields
  `https://<extension-id>.chromiumapp.org/`. Register that exact string as a
  redirect URI on your Are.na OAuth app. It's HTTPS, so the secure-context and
  exact-match constraints above are satisfied.
- PKCE still applies — an extension bundle is public, so no client secret.
- MV3 service workers are evicted aggressively: never hold the token in a
  module-level variable as the source of truth. `chrome.storage.session` is the
  closest analogue to `sessionStorage` (memory-only, not written to disk);
  `chrome.storage.local` is the "remember me" tier. Offer the choice, given
  tokens never expire.
- Put `https://api.are.na/*` (and `https://www.are.na/*` if you need it) in
  `host_permissions`. Extension pages have their own CSP — the `connect-src`
  advice in §7 still applies.

---

## 4. Request/response conventions

Every v3 collection endpoint returns the same envelope: **[verified]**

```jsonc
{
  "data": [ /* … items … */ ],
  "meta": {
    "total_count": 128,        // sometimes `total` — read defensively
    "has_more_pages": true     // authoritative; don't infer from page length
  }
}
```

Pagination is `?per=<n>&page=<1-based>`. `per=50` worked reliably. Use
`meta.has_more_pages` when present and fall back to
`items.length === per` otherwise. **[verified]**

### Errors

- `401` — token rejected. Clear stored token, re-prompt.
- `402` / `403` — access denied; **often means "needs Are.na Premium"** rather
  than a bug (see §5). Word the message accordingly.
- `429` — rate limited. Read `X-RateLimit-Reset` (a **Unix timestamp** of the
  current window's end, not a duration) to say *when* to retry. **[verified]**
- `400` — several endpoints validate enum params strictly (see connections
  `sort` in §5). A 400 usually means an invalid parameter *value*, not a
  malformed request.

Error bodies aren't uniformly shaped; read `body.message || body.error || ''`
and always tolerate a non-JSON body. **[verified]**

### Rate limits

Documented per-tier, per-minute: **guest 30 · free 120 · premium 300 ·
supporter 600**. **[docs]** `X-RateLimit-*` headers accompany responses.

This is a real design constraint, not a footnote. Our first version issued one
enrichment request *per block*, so a 50-item page cost ~100 requests and brushed
the free-tier ceiling. Budget requests per user-visible action, and prefer
lazy/on-demand enrichment (e.g. `IntersectionObserver` for visible items) over
eager fan-out. **[verified]**

---

## 5. The endpoints we actually used

Only three — the whole app is built on them.

### `GET /v3/search` — the workhorse

Are.na's search doubles as a general-purpose feed query. With a wildcard query
it becomes "give me blocks matching these filters, sorted."

```
GET https://api.are.na/v3/search
    ?query=*                  # wildcard — match everything
    &scope=following          # all (default, omit) | my | following
    &type=Link                # Link | Image | Embed | Attachment | Text | Block (=all)
    &sort=created_at_desc     # created_at_desc | updated_at_desc | random
                              #   | connections_count_desc
    &after=<ISO8601>          # lower bound on creation time
    &per=50
    &page=1
```

**[verified]** — every parameter and value above was exercised.

- `scope=following` is the "my network" feed — content from people you follow.
  **This is the one likeliest to require Are.na Premium**; a `402`/`403` here is
  an account-tier signal, so handle it as UX rather than an error. **[verified]**
- `scope=my` is your own content; omit `scope` for all of Are.na.
- A "popular" feed is `sort=connections_count_desc` + `after=<30 days ago>`.
  Note the ranking is by **all-time** connection count — the API can't rank by
  *recent* connection activity, so any "trending" framing is a lie you'd be
  telling users. Say "created recently, most connected." **[verified]**

### `GET /v3/blocks/{id}/connections` — which channels hold this block

The subtlest endpoint we touched, and worth the paragraph:

```
GET /v3/blocks/{id}/connections?per=1&sort=created_at_asc
```

- Returns **plain Channel objects**. There is no `connected_by`, no
  `connected_at`, and no connector user. **[verified]**
- **`created_at` on each item is the channel's own creation date**, not the
  connection's. Sorting client-side by that field orders channels by age and
  gives wrong answers.
- **The API's ordering is by connection creation time.** Trust it; do not
  re-sort. `sort` accepts *exactly* `created_at_desc` (default) and
  `created_at_asc` — anything else is a `400`. **[verified]**
- So: **oldest connection = the block's originating channel** (§1). One request
  with `per=1&sort=created_at_asc` gets it. Degrades gracefully to "oldest
  connection still visible to you" when the original was deleted or lives in a
  private channel.
- The channel's owner is `owner` (`owner.slug`), **not** `user`. **[verified]** —
  we shipped a bug assuming `user` and every channel link silently fell back to
  the degraded URL form.
- `meta.total_count` on the same response gives the connection count, so channel
  attribution and a "×N connections" badge cost **one** request, not two.

### `GET /v3/me` — the signed-in user

Returns the user object (`name`, `slug`, `avatar`). Doubles as a cheap token
validity check on startup. **[verified]**

---

## 6. Block data shapes (as observed)

Fields vary by block type and by how the block was created, so write defensive
accessors. These are the ones ✶✶ Reader relies on: **[verified]**

```jsonc
{
  "id": 46963301,
  "title": "…",                       // often absent — fall back to source domain
  "description": { "html": "…", "markdown": "…", "plaintext": "…" },
  "content":     { /* same union; text blocks put their body here */ },
  "source": { "url": "https://…", "provider": { "name": "YouTube" } },
  "image":  { "square": {"src": …}, "small": {…}, "medium": {…},
              "large": {…}, "original": {…} },
  "user":   { "name": "…", "slug": "…", "avatar": "…" },   // avatar: string OR {src|url}
  "created_at": "2026-…", "updated_at": "2026-…"
}
```

Accessor patterns that survived contact with real data:

```js
// Rich text arrives as a union: string | {plaintext|plain_text|markdown|html}
const text = mc => typeof mc === 'string' ? mc
  : mc?.plaintext ?? mc?.plain_text ?? mc?.markdown ?? (mc?.html && stripHtml(mc.html)) ?? '';

// Images: pick the largest variant you'll actually display, then unwrap src|url
const img = b => { const v = b.image && (b.image.medium || b.image.large
  || b.image.square || b.image.small || b.image); return v?.src || v?.url || null; };

// Avatars are sometimes a bare URL string, sometimes an object
const avatar = u => typeof u?.avatar === 'string' ? u.avatar : (u?.avatar?.src || u?.avatar?.url || null);
```

Display notes: `source.provider.name` is a friendly label ("YouTube") but is
absent for most links — deriving the hostname from `source.url` is more
consistent. Link blocks should open `source.url`; everything else opens
`https://www.are.na/block/{id}`.

---

## 7. Security lessons (all paid for in this project)

A formal audit lives in [`security-audit.md`](./security-audit.md). The
transferable parts:

1. **Block content is untrusted user HTML.** `description.html` is authored by
   whoever you follow. We parsed it with `innerHTML` on a detached `<div>` —
   which still *activates* content: `<img src=x onerror=…>` fires. Use an inert
   document:

   ```js
   const stripHtml = html => new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
   ```

   Everywhere else, render with `createElement` + `textContent`. Never
   interpolate API strings into HTML.

2. **Combine that with never-expiring tokens** and one malicious block
   description exfiltrates a permanent credential. This is the threat model.

3. **Ship a CSP.** For a single-origin client:

   ```
   default-src 'self'; script-src 'self'; style-src 'self';
   connect-src 'self' https://api.are.na; img-src 'self' data: https:;
   object-src 'none'; base-uri 'none'; form-action 'self'
   ```

   `img-src https:` stays broad because thumbnails come from Are.na's CDN.

4. **Don't leak reading metadata.** We used Google's favicon service, which
   shipped every domain the user browsed to a third party — and contradicted our
   own privacy copy. Fetch `https://<domain>/favicon.ico` directly and drop
   broken images on `error`.

5. **Default token storage to the session tier**, with an explicit "Remember on
   this device" opt-in for persistent storage. Matches Are.na's own reference
   client, and the tradeoff is the user's to make.

6. `rel="noopener"` on every `target="_blank"`; token inputs `type="password"`
   with `autocomplete="off"`.

---

## 8. Quick-start checklist

1. Grab a PAT from
   [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens);
   `curl -H "Authorization: Bearer $TOKEN" 'https://api.are.na/v3/me'` to
   confirm the wiring before writing any UI.
2. Fetch `https://api.are.na/v3/openapi.json` and read the endpoints you plan to
   use. It is the authority; this document is a summary.
3. Build the feature on the PAT. Add OAuth + PKCE as a separate layer once the
   data path works — same `Authorization` header either way.
4. Register the OAuth app at
   [are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications)
   with every redirect URI you need (production + `127.0.0.1` dev + extension
   `chromiumapp.org` URL), scope `read` unless you write.
5. Count your requests per user action against the free tier's 120/min *before*
   you fan out per-item enrichment.
6. Handle `401` (re-auth), `402`/`403` ("may require Premium"), `429`
   (`X-RateLimit-Reset`) explicitly — all three happen in normal use.

Zero dependencies were needed: `fetch` + `crypto.subtle` covers the entire
surface, OAuth included.
