# Are.na Connections — design & development plan

> **Historical popup plan.** The implemented `0.2.0` surface is now a Chrome
> side panel. For the current interaction, privacy, metadata, architecture, and
> acceptance contracts, read [`sidebar-rewrite-plan.md`](./sidebar-rewrite-plan.md).

A Chrome extension that tells you whether the page you're on already exists as a
block in someone's public Are.na channel — and lets you walk those connections.

The destination is ambient: a badge that lights up as you browse. The MVP is a
click-to-check lookup, for reasons in §1.5.

Status: **superseded by the implemented side-panel rewrite.**
API surface: **v3, authenticated.** Requires an Are.na Premium account (§2.2).
Interaction model: **manual check (click to look up).** Ambient is phase 2 (§1.5).

### Implementation clarification (2026-08-05)

- `@types/chrome` is permitted as a development-only type package. It adds no
  extension runtime code and lets TypeScript validate the Chrome API boundary.
- OAuth support can be built and unit-tested, but a live OAuth smoke test
  requires an Are.na OAuth application/client ID registered to the extension's
  exact `chromiumapp.org` redirect. The PAT path remains the executable MVP
  acceptance path until that external registration exists.
- A successful build, manifest validation, and error-free service-worker import
  establish that `dist/` is load-ready. Final unpacked loading still happens via
  Chrome's `chrome://extensions` UI because Chrome exposes no supported CLI for
  installing an arbitrary unpacked extension into the user's profile.
- The phase-2 `getConnections` request reuses the existing `result` response
  with `status: 'error'` when connection loading fails. The fixed contract has
  no separate phase-2 error variant; this convention prevents `403`/network
  failures from being misrepresented as an empty connection set.
- Vite module-preload generation is disabled. Chrome extension execution worlds
  reject those optional preload hints as cross-world resources; native module
  imports still load the same code-split chunks without console warnings.

All API claims were verified against the live API on 2026-08-05 with a
supporter-tier token. §2.8 separates what was tested from what wasn't.

> **Revision note.** Three things changed from the first draft. (1) We now build
> on **v3 + auth** rather than anonymous `/v2/search` (§2.2). (2) The severe
> rate-limiting constraint that draft reported **was wrong** — an artifact of the
> test harness, not the API (§2.6); don't reason from it. (3) The MVP is now
> **manual lookup**, with ambient deferred to phase 2 (§1.5). If you read the
> earlier draft, re-read §1.5, §2.6, and §4.5.

---

## 1. Product

### 1.1 The idea

Readwise Reader's extension maintains a live relationship between the page in
front of you and your saved library. Are.na's official extension saves *to*
Are.na and tells you about **your own** connections. Nobody surfaces the thing
that makes Are.na interesting: **the same URL living in many strangers' channels
at once.**

That's the product. Browse the web; when a page you're looking at is already a
block somewhere public, say so, and show whose channels it's in.

### 1.2 The core loop

```
you're on a page and wonder whether it's on Are.na
  → you click the extension icon
  → it resolves the URL to Are.na block(s)
  → panel lists the channels holding this URL, with owner + channel title
  → you click through to are.na and fall down a hole
```

### 1.3 MVP scope

**In:**

- Are.na sign-in. PAT to start, OAuth 2.0 + PKCE before it leaves your machine.
- **Manual lookup**: click the toolbar icon to check the current page.
- Popup listing the channels this URL is connected to (owner, channel title,
  link out to are.na).
- Local cache so re-checking a page is instant and free.
- Local hit-rate counter (§1.5).

**Explicitly out (for now):**

- **Ambient/background lookup and the badge — deferred to phase 2 (§1.5).**
- Saving to Are.na. The official extension already does this well, and staying
  read-only keeps us on `read` scope.
- Highlighting / annotation. That's the Readwise analogy taken too literally —
  Are.na has no highlight primitive, so this would mean inventing storage we
  don't have.
- In-page content-script UI (see §10.2).
- An anonymous / non-Premium fallback (see §10.3 — deliberately deferred, not
  abandoned).
- Firefox/Safari. Chrome MV3 first; the code stays portable but we don't pay the
  cross-browser tax yet.

### 1.4 The one honest caveat

This works well for **content pages with words in the URL** and essentially not
at all for **opaque-ID URLs** (Pinterest pins, Facebook photos, CDN asset links,
`?id=39000000`). §2.5 has the measured numbers and the reason. The UI must
therefore treat "no connections found" as *"we didn't find any"*, never *"there
are none"* — §5.3 specifies the copy.

### 1.5 Manual first, ambient second — and why

The original concept is *ambient*: a badge that lights up as you browse, telling
you about connections you didn't know to look for. That remains the destination
(§10.1). The MVP ships manual lookup anyway, for two reasons — **neither of them
rate limits**:

1. **Permissions.** Ambient requires the `tabs` permission, which Chrome
   presents to users as *"Read your browsing history."* Manual needs only
   `activeTab`: scoped to one tab, granted on click, **no permission warning
   shown at all.**
2. **Privacy, given we now require sign-in.** Ambient + authenticated means
   sending your browsing history to Are.na *attributably, tied to your account*.
   That is a materially heavier ask than the anonymous design would have been.
   Manual reduces it to only the pages you deliberately ask about.

**Rate limits are explicitly not a reason.** At a 300/min Premium floor and ~2
requests per uncached page, ambient browsing costs roughly 3 requests/minute —
about 1% of budget (§2.6). Don't let this belief drive design decisions.

**The honest cost.** This is a product change, not just sequencing. Ambient is a
*discovery* tool; manual is a *lookup* tool that requires you to already suspect
something is there. The MVP will feel like a good utility, not like the idea in
§1.1. Accepted knowingly, to get something finishable and privacy-cheap first.

**What phase 2 costs:** almost nothing. Resolver, auth, API client, cache, and
popup all carry over unchanged. Ambient adds tab listeners, debounce, and badge
management — plus the `tabs` permission and its disclosure.

**The constraint that keeps that true:** `resolve.ts` takes a **URL**, and the
cache is keyed by **normalized URL** — never "the current tab." No module below
the popup may know what a tab is. If manual bakes in tab-centric assumptions,
ambient becomes a refactor instead of an addition.

**Instrument the decision.** Track locally (never transmitted) how many manual
checks return ≥1 connection. That hit rate is what tells you whether an ambient
badge would be delightful or mostly-empty noise — and it can't be guessed now.

---

## 2. Feasibility: what the API can and cannot do

This section is why the plan is shaped the way it is. **Read it before writing
code.** Several intuitive approaches are dead ends, and one intuitive-sounding
constraint turned out to be imaginary.

### 2.1 The central problem

Are.na has **no URL→blocks lookup endpoint.** The full v3 path list contains
nothing like `GET /blocks?source_url=…`. A block's `source.url` is a field you
can read once you already have the block, not one you can query by.

So "who else saved this URL?" has to be *reconstructed* from a text search index
that happens to include source URLs. That reconstruction is the heart of this
extension, and §2.4 specifies it.

### 2.2 Why v3 + authentication

| Endpoint | Auth | Verdict |
| --- | --- | --- |
| `GET /v3/search` | **Bearer token + Premium** | ✓ **Our search.** `401` anonymous; the OpenAPI description is flagged `⚠️ Premium Only`. Verified working on a supporter-tier token. |
| `GET /v3/blocks/{id}/connections` | none | ✓ **Our connections list.** Channels with `owner`, plus `meta.total_count`. |
| `GET /v3/blocks/{id}` | none | ✓ Full public block JSON. |
| `GET /v3/me` | Bearer | ✓ Cheap token-validity check; returns `badge` (tier). |
| `GET /v2/search` | none | Deferred fallback only — see §10.3. |

**The decision.** v3 requires a paying account for search, which is a real
product cost. We're accepting it for three reasons, in order of weight:

1. **v2 is deprecated.** [dev.are.na](https://dev.are.na) states the V2 API
   documentation portal is deprecated and the V2 Channels API is superseded by
   V3. No sunset date is published, but the direction is unambiguous and the
   current [developers site](https://www.are.na/developers) documents v3 only.
2. **The anonymous v2 path was a workaround, not a supported path.** Are.na
   gated v3 search behind Premium deliberately. Reaching around that to an older
   endpoint that answers anonymously — probably through legacy inertia rather
   than intent — is not "following best practices" regardless of version number,
   and is exactly the sort of gap that gets closed without warning.
3. **Authentication is better engineering.** Documented rate limits with real
   `X-RateLimit-*` headers, a working `type` filter, exact `total_count`, and a
   spec that is the tiebreaker for every question.

**Recall cost of this decision: zero.** Measured head-to-head, v3 and v2 agree
on all 24 ground-truth URLs (§2.5).

### 2.3 What Premium actually gates

Only `/v3/search`. Both connection and block reads are public and
unauthenticated. This is worth internalizing because it shapes §10.2: the
expensive, gated call is *discovery*, and everything downstream of it is free.
Any future non-Premium mode only needs to replace the discovery step.

### 2.4 The resolver algorithm

`/v3/search` is a fuzzy full-text index over titles, descriptions, and — the
load-bearing discovery — **source URLs, tokenized.** It does not take a URL as a
query. Measured, against a page whose URL is on Are.na four times:

```
query=https://www.seangoedecke.com/llms-reward-expertise/   → 50 returned, total=10000, 2 correct  (fuzzy garbage)
query=seangoedecke.com/llms-reward-expertise                → 50 returned, total=10000, 2 correct  (fuzzy garbage)
query=seangoedecke llms reward expertise                    → 4 returned,  total=4,     4 correct  ✓
```

Note the third row: a **complete and exact** result set, not a truncated fuzzy
one. Passing the raw URL "works" in the sense of returning 200 — and is useless.

So the recipe is: **turn the URL into bare word tokens, search, then filter the
results client-side by exact normalized-URL equality.** Search provides recall;
our own comparison provides precision.

Three rules, each learned from a failure. **All three behave identically on v2
and v3** — the tokenization logic is portable across both backends.

1. **Strip punctuation.** Split the path on `/`, `-`, `_`, `.`, `+`.

2. **Use the registrable domain label, not the first host label.** Naively taking
   `host.split('.')[0]` yields `en` for `en.wikipedia.org` — a useless token that
   poisons the query. Take the second-to-last label (with a small multi-part-TLD
   exception list): `en.wikipedia.org` → `wikipedia`, `news.ycombinator.com` →
   `ycombinator`, `www.theguardian.co.uk` → `theguardian`.

3. **Drop stopword path segments, and cap token count.** The most important rule
   and the least obvious. Queries are **conjunctive** — *more tokens
   monotonically shrink the result set* — so structural path noise silently
   destroys recall:

   ```
   query=wikipedia wiki Walter Van Beirendonck   → 0 results         ← 'wiki' kills it
   query=wikipedia Walter Van Beirendonck        → 4 results, 1 exact ✓
   ```

   Verified identical on v3 and v2. Maintain a stopword set (`wiki`, `html`,
   `index`, `page`, `post`, `blog`, `article`, `news`, `item`, `view`, `en`,
   `amp`, `id`, `p`, …), drop pure digits and ≤3-char fragments, cap at **4 path
   tokens**.

   **This failure mode is invisible** — zero results, not an error. It would ship
   silently. Test for it.

**URL normalization** (used for query building *and* the equality filter):
lowercase host, drop `www.`, drop port, strip trailing slash, remove tracking
params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`,
`source`, `_hsenc`), sort the rest. Verified to correctly match a Slate article
carrying `?utm_source=pocket&utm_medium=email` to its stored block.

**The `type` parameter.** `type=Link` is the obvious filter but risks missing a
URL saved as an `Embed` or `Image` block. Since our client-side filter is exact,
a wider net costs only result-slot dilution against `per=50`. **Default to
`type=Link,Embed,Image`**, keep it a single tunable constant, and validate on
embed-heavy URLs (YouTube, Vimeo) during build — that case is untested (§2.8).

**Query budget: at most 2 searches per URL**, most specific first
(`label + slug`, then `slug` alone), unioned, early exit at 5 matches. Measured
average: **1.9 search calls per lookup.**

A working reference implementation lives at
[`docs/reference/resolver.py`](./reference/resolver.py). It is the spec; the
TypeScript port should reproduce its behavior and its fixtures should become
unit tests.

### 2.5 Measured accuracy

Method: harvest real Link-block source URLs from search (so each is *provably* an
Are.na block), then run the resolver on each and see if it finds them again.
Ground truth harvested via v3 so the set isn't biased toward either backend.

| Backend | Recall (article-like URLs) | n |
| --- | --- | --- |
| **v3, authenticated** | **88%** | 24 |
| v2, anonymous | 88% | 24 |
| v2, anonymous (earlier separate run) | 90% | 20 |
| v2, mixed population incl. social/CDN/opaque URLs | 52% | 25 |

v3 and v2 agreed on **every URL** in the head-to-head — same hits, same three
misses — differing only slightly in how many blocks each surfaced. **The
migration to v3 costs nothing in recall.**

The 52% row is not a quality problem to fix — it's a **population** problem. The
misses were near-perfectly predictable:

- `ar.pinterest.com/pin/1688918604964037/`
- `facebook.com/533722736653230/photos/pcb.2686724…`
- `cdn.shopify.com/s/files/1/1159/3118/files/00_2015…`
- `78.media.tumblr.com/311748aa9e2330c23f719ed78b23e795/…`

These paths contain no words, so no text index can retrieve them by any query.
**For genuine article/essay/product pages — the browsing this extension is for —
recall is ~88–90%.**

Precision is ~100% by construction: the normalized-URL equality filter admits no
false positives, whatever search returns.

**Implementation consequence:** classify the URL *before* spending a request. If
the hostname and path together have fewer than two useful lexical tokens, or the host matches a known
opaque-asset pattern, **skip the lookup entirely** and tell the user why (§5.3).

### 2.6 Rate limits — correcting an earlier error

**The earlier draft of this plan was wrong about this, and the error was mine.**
It reported that anonymous bursts returned `403` with no rate-limit headers,
recovering after ~45s, and it built a whole request-discipline regime around
that. Recorded here because the wrong conclusion was load-bearing:

> The `403`s were caused by Python's default `User-Agent: Python-urllib/3.x`
> being blocked at the CDN. They had nothing to do with request volume. The same
> requests with any other User-Agent returned `200` at full speed.

Isolated cleanly — same URL, same token, same instant:

```
urllib default UA (Python-urllib)  -> 403
custom UA                          -> 200
browser-ish UA                     -> 200
urllib default UA again            -> 403
```

**The actual measured limits**, with a normal User-Agent:

- 30 authenticated searches back-to-back, no delay → **30/30 `200`**, 13.9s.
- 25 anonymous connection reads back-to-back → **25/25 `200`**, 4.7s.
- Headers present and honest: `x-ratelimit-limit: 600`,
  `x-ratelimit-window: 60`, `x-ratelimit-tier: supporter`, `x-ratelimit-reset`
  (a **Unix timestamp**, not a duration).

Documented per-tier ceilings: guest 30 · free 120 · premium 300 · supporter 600
per minute. Search needs Premium, so the floor for our users is **300/min**.

At ~10 requests per page-lookup worst case, that's ~30 fresh page-lookups per
minute — far beyond real browsing, especially with caching. **Rate limiting is
not an architectural constraint for this extension.** §4.5 is correspondingly
modest.

Two lessons that survive the correction:

- **A Chrome extension is unaffected by the UA issue** — `fetch` from a service
  worker sends Chrome's own User-Agent, and `User-Agent` is a forbidden header
  we couldn't override anyway. This was purely a test-harness artifact. But any
  script we write to probe the API must set a UA, or it will lie to us again.
- **Still treat `403` as ambiguous.** It is not necessarily "forbidden" and not
  necessarily "throttled" — it can be CDN-level rejection. Never render a `403`
  as "no connections found." Surface it as an error (§5.3).

### 2.7 The connections read

For each matched block:

```
GET /v3/blocks/{id}/connections?per=10        (no auth required)
```

Returns plain Channel objects. Traps, all still true:

- The channel owner is `owner`, **not** `user`. Getting this wrong silently
  degrades every are.na link to the fallback form.
- `created_at` on each channel is the *channel's* creation date, not the
  connection's. **Do not re-sort** — the API's order is already connection order,
  so the oldest connection is the block's originating channel.
- `meta.total_count` gives the connection count for free — no second request.

Live example, four different blocks of one URL:

```
49219017 → om-jha-ei_kihogzrq/summer-2026-0htvkkmjjwe
49233611 → laurence-ininda/ai-software-development
49221326 → connor-geiman/good-stuff-for-llms
49228907 → dajb/tech-kfn6yqfv1qy
```

That output *is* the product.

### 2.8 Verified vs. assumed

**Verified live** (2026-08-05, supporter-tier token): every row of §2.2;
`/v3/search` returning exact scoped result sets for token queries; the
tokenization rules and their failure modes on **both** v3 and v2; the 88%/88%
head-to-head recall; the User-Agent `403` cause and the true throughput
measurements; URL normalization against a tracking-param URL; the connections
shape and `owner` field.

**Not verified — confirm during build:** behavior on a **Premium (300/min)**
rather than supporter token — the tier gate is documented but only supporter was
tested; whether `type=Link,Embed,Image` beats `type=Link` on embed-heavy URLs
(YouTube/Vimeo test returned nothing for either, so the comparison is
unresolved); `chrome.storage` quota behavior past a few thousand cache entries;
deep pagination (`page`) on our query shapes; whether OAuth-issued tokens behave
identically to PATs for search (expected — the primer verified they're
interchangeable bearer tokens, but not for this endpoint).

**Known unknown:** whether a free-tier token returns `402`, `403`, or empty
results from `/v3/search`. This determines the signed-in-but-not-Premium error
state in §5.3. **Test this early** — it's a first-run UX path we cannot guess at.

**Live-data update (2026-08-05, implementation):** The former negative smoke
fixture, `en.wikipedia.org/wiki/Brutalist_architecture`, is no longer negative:
both the TypeScript resolver and `docs/reference/resolver.py` now find four exact
blocks and public connections. The §8 clean-miss fixture is now
`en.wikipedia.org/wiki/Chicago_Lake_Tunnel` (0 exact blocks in both resolvers at
the time of implementation). This is expected external data drift, not a recall
regression.

**Resolver update (2026-08-05, implementation):** The original “fewer than two
lexical path tokens” preflight rule incorrectly skipped meaningful root URLs.
Verified example: `negative.sanctuary.computer/` is block `49271337`, and both
`negative sanctuary` and `sanctuary` retrieve it from v3 search. Classification
now requires two useful tokens across the **hostname plus path**; meaningful
subdomains participate in root-page queries. Known opaque hosts/patterns remain
hard skips, and exact normalized-URL filtering still guarantees precision.

---

## 3. Stack & repo layout

Vite + TypeScript, vanilla DOM, no UI framework. Typed module boundaries are what
make the parallel build in §7 safe; React would be weight for one popup panel.

No `@crxjs/vite-plugin` — it's a moving target. A static `public/manifest.json`
plus explicit Rollup entry points is boring and stable.

```
Are.na-Browser-Extension/
├── docs/
│   ├── arena-api-primer.md              # prior-art handoff notes
│   ├── design-and-development-plan.md   # this file
│   └── reference/resolver.py            # validated reference implementation
├── public/
│   ├── manifest.json
│   └── icons/{16,32,48,128}.png
├── src/
│   ├── core/                # pure, DOM-free, unit-tested
│   │   ├── types.ts         # shared domain types       ← contract, land first
│   │   ├── messages.ts      # SW ↔ popup protocol       ← contract, land first
│   │   ├── url.ts           # normalize, tokenize, classify
│   │   ├── auth.ts          # token storage, PAT + OAuth/PKCE
│   │   ├── arena.ts         # API client (auth header, errors, retry)
│   │   ├── resolve.ts       # orchestrator: URL → LookupResult
│   │   ├── cache.ts         # TTL cache over chrome.storage.local
│   │   └── settings.ts      # prefs + local hit-rate counter (§1.5)
│   ├── background/
│   │   └── service-worker.ts
│   ├── popup/
│   │   ├── popup.html · popup.ts · popup.css
│   └── options/
│       ├── options.html · options.ts    # sign-in lives here
├── test/                    # vitest
├── vite.config.ts · tsconfig.json · package.json
```

---

## 4. Architecture

### 4.1 Components

```
┌─ popup (the only trigger in the MVP) ──────────────┐
│  user clicks the toolbar icon                      │
│    → chrome.tabs.query → current tab URL           │
│       (activeTab granted by the click itself)      │
│    → send { kind: 'lookup', url } to SW            │
│    → render loading → results                      │
└────────────────────────────────────────────────────┘
        │ chrome.runtime message (typed, §4.3)
┌─ service worker (MV3, ephemeral) ──────────────────┐
│  on 'lookup' message:                              │
│    → signed in?  → url.classify()  → bail if not   │
│    → cache.get(normalizedUrl)                      │
│    → miss? resolve.blocksFor(url)   [phase 1]      │
│    → resolve.connectionsFor(blocks) [phase 2]      │
│    → cache.put, reply                              │
└────────────────────────────────────────────────────┘
```

The service worker holds no tab state and registers no tab listeners. Phase 2
adds `tabs.onActivated`/`onUpdated` above this, calling the same message path
(§1.5).

### 4.2 Two-phase lookup

Resolution stays split in two, even though the manual MVP triggers both from the
same click:

- **Phase 1 — blocks.** 1–2 search requests → the block list and the count.
- **Phase 2 — connections.** One request per matched block, capped at **8**,
  ordered by connection count. Show "and N more" past the cap.

Render phase 1 as soon as it lands ("4 blocks found") rather than waiting on
phase 2 — it arrives in one round trip and makes the popup feel immediate.

Keep the split even though nothing forces it today. It is what lets phase 2
(§1.5) put the cheap half on a background trigger for the badge and the
expensive half behind the popup, without restructuring `resolve.ts`.

### 4.3 Shared contracts

These land **before** any parallel work. Everything else is written against them.

```ts
// src/core/types.ts
export type LookupStatus =
  | 'hit' | 'miss' | 'skipped' | 'unauthenticated' | 'not_premium' | 'error';

export interface ArenaBlock {
  id: number;
  title: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  blockType: string;                // 'Link' | 'Image' | 'Embed' | …
  userName: string | null;
  userSlug: string | null;
  userAvatarUrl: string | null;
  createdAt: string | null;
  connectionCount: number | null;   // meta.total_count, once known
}

export interface ArenaChannel {
  id: number;
  slug: string;
  title: string;
  ownerSlug: string | null;    // from `owner`, NOT `user` — see §2.7
  ownerName: string | null;
  status: string | null;       // 'public' | 'closed' | …
  webUrl: string;              // are.na/{ownerSlug}/{slug}, degraded if no owner
}

export interface LookupResult {
  normalizedUrl: string;
  status: LookupStatus;
  blocks: ArenaBlock[];
  fetchedAt: number;                              // epoch ms
  connections?: Record<number, ArenaChannel[]>;   // phase 2 only
}

// src/core/messages.ts
// NOTE: every request carries a URL, never a tabId. Only the popup knows tabs.
// This is what keeps ambient (§1.5) an addition rather than a refactor.
export type Request =
  | { kind: 'lookup'; url: string }                    // phase 1
  | { kind: 'getConnections'; normalizedUrl: string }  // phase 2
  | { kind: 'getAuthState' }
  | { kind: 'signIn' }
  | { kind: 'signOut' };

export type Response =
  | { kind: 'result'; result: LookupResult }
  | { kind: 'connections'; connections: Record<number, ArenaChannel[]> }
  | { kind: 'authState'; signedIn: boolean; userSlug: string | null; tier: string | null }
  | { kind: 'ok' };
```

### 4.4 Caching

`chrome.storage.local`, keyed by normalized URL.

- **Hits** cached 7 days; connections cached alongside once fetched.
- **Misses** cached 24h — a URL can genuinely get connected later.
- **Errors and auth failures never cached.**
- LRU eviction at ~2000 entries.
- Keep cache data below 8 MB as well as the entry cap, leaving headroom under
  Chrome's 10 MB `storage.local` quota for credentials and settings.
- **Clear the whole cache on sign-out.**

### 4.5 Request discipline

All Are.na traffic goes through `arena.ts`. Minimal, because §2.6 says it can be
and because a manual MVP only issues requests on an explicit click:

- Concurrency **3**; no artificial inter-request delay.
- Cap **10 requests per lookup**, phases combined.
- Ignore repeat clicks while a lookup for the same URL is in flight.
- *(Phase 2 adds: debounce navigation 1.2s, active tab only, never prefetch.)*
- On `429`: honor `X-RateLimit-Reset` (Unix timestamp) and pause the queue until
  then. On `403`/`5xx`: retry once with backoff, then surface as `error` — never
  as `miss` (§2.6).
- On `401`: clear the stored token and set status `unauthenticated`. Tokens never
  expire, so a `401` means revoked or wrong, not stale.
- Skip non-`http(s)` schemes, `localhost`, private IPs, and anything
  `url.classify()` rejects (§2.5).

### 4.6 Manifest

```jsonc
{
  "manifest_version": 3,
  "name": "Are.na Connections",
  "version": "0.1.0",
  "description": "See which public Are.na channels already hold the page you're on.",
  "permissions": ["activeTab", "storage", "identity"],
  "host_permissions": ["https://api.are.na/*"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html", "default_icon": { } },
  "options_page": "options/options.html",
  "icons": { }
}
```

**`activeTab`, deliberately not `tabs`.** Clicking the action grants access to
that one tab, and Chrome shows **no permission warning** for it. `tabs` would
display *"Read your browsing history."* This is the concrete payoff of §1.5 and
the line phase 2 has to cross — when it does, the disclosure in §6 becomes
mandatory rather than merely good practice.

`identity` is for `launchWebAuthFlow` (§4.7). No `alarms` — nothing is scheduled.

### 4.7 Authentication

Build in two stages so the data path is never blocked on OAuth:

**Stage 1 — PAT.** Paste a token from
[are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens)
into the options page. Ships the whole feature; unblocks every other workstream.

**Stage 2 — OAuth 2.0 + PKCE.** Per the primer's §3:

- `chrome.identity.launchWebAuthFlow` with `chrome.identity.getRedirectURL()`,
  yielding `https://<extension-id>.chromiumapp.org/`. Register that string
  **exactly** at [are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications).
- PKCE, no client secret — an extension bundle is public. Client IDs are
  committable; Are.na's own CLI hardcodes one.
- Scope `read`. We don't write.
- Validate `state`; discard the authorization code immediately after exchange.
- Authorize `https://www.are.na/oauth/authorize`, token
  `https://api.are.na/v3/oauth/token`.

Both stages produce a bearer token; `arena.ts` never knows which it holds.

**Token storage.** Are.na tokens **never expire and have no revocation
endpoint** — a leaked one is a permanent credential, and signing out is local
only. Default to `chrome.storage.session` (memory-only), with an explicit
"Remember on this device" opt-in for `chrome.storage.local`. Matches Are.na's own
reference clients. Say plainly in the UI that full revocation means deleting the
token in Are.na settings.

---

## 5. UI

### 5.1 Badge — not in the MVP

Manual lookup means nothing is known about a page until you click, so there is
nothing to badge. The toolbar icon is a button, not an indicator.

Reserved for phase 2 (§1.5), where the rules will be: count when found; **no
badge** for zero/skipped/unresolvable, so absence of signal looks like absence of
signal rather than a negative result; no badge when signed out or errored.

### 5.2 Popup

```
┌──────────────────────────────────────────┐
│  4 blocks · 4 channels                   │
│  seangoedecke.com/llms-reward-expertise  │
├──────────────────────────────────────────┤
│  good stuff for LLMs                     │
│  connor-geiman                           │
│                                          │
│  AI & Software Development               │
│  laurence-ininda                         │
│                                          │
│  Tech                                    │
│  dajb                                    │
│                                          │
│  summer 2026                             │
│  om-jha-ei_kihogzrq                      │
├──────────────────────────────────────────┤
│  ⚙ settings                              │
└──────────────────────────────────────────┘
```

Results are block-first: one row per discrete matching block ID, with its
creator avatar/name, connection count, and up to two loaded channel titles as
secondary context. The numeric block ID stays out of the visible UI. A
single block connected to several channels must not become several duplicate
rows. Rows link to the exact block at `https://www.are.na/block/{blockId}`;
Are.na's external channel URL cannot carry the in-app navigation state that
opens a block over a specific channel, so the canonical block URL is the
reliable way to reveal that copy and its complete connection graph. Every row
is built with `createElement` + `textContent` (§6).

The side panel uses a fluid white canvas and a deliberately narrow type
hierarchy to stay close to Are.na's own utility UI. Its header sums each
matching block's complete connection total; rows remain one-per-block and lead
with the originating channel name.

The styling adaptation is sourced from the official `aredotna/ervell` frontend
at commit `2fcb6d2b85b4d6fbe6cd1a36641aac2d91955c47`: `src/v2/styles/{colors,text,
constants}.ts`, `UI/Layouts/BlankLayout/components/BaseStyles`, `GenericButton`,
`Inputs` (mixin, TextInput, Checkbox, Label, LabelledCheckbox), the settings page,
`ProfileChannels/ChannelRow`, and `UI/HorizontalRule`. The extension maps its
Arial stack, `#333/#585858/#999/#eee` neutrals, `#00bbf7` focus color, compact
spacing/line heights, outlined controls, and `0.25em` control radius without
importing Are.na runtime code.

The block list can be sorted by most connections, least connections, newest, or
oldest. “Newest/oldest” uses each block's `created_at`, which is the time of its
originating connection; the API exposes later connection ordering but not later
connection timestamps, so the UI deliberately calls these copies rather than
claiming to sort all channel connections by date. Each row also displays this
immutable creation date beside the creator; `updated_at` is deliberately not
used. The sort control sits as a full-bleed row below the result count and URL,
before the list begins.

Because the whole lookup now happens *while the user watches*, loading states
matter more than they would have ambiently. Render a short connection-loading
label until every per-block total is known, then replace it with their exact
sum. Channel names fill the list as phase 2 resolves.

No on/off toggle or skip-list here: with manual lookup there is nothing running
to switch off. Both arrive with phase 2 (§6).

### 5.3 Empty and error states — write these carefully

Copy here is a correctness issue, not polish (§1.4, §2.5):

| Situation | Copy |
| --- | --- |
| Resolved, nothing found | *"No public connections found."* — never "This page isn't on Are.na." |
| Unresolvable URL (opaque path) | *"This kind of URL can't be looked up on Are.na."* + one-line why |
| Signed out | *"Sign in to Are.na to see connections."* + sign-in button |
| Signed in, not Premium | *"Are.na search requires a Premium account."* + link. **Confirm the actual API response first (§2.8).** |
| `401` | *"Your Are.na token was rejected."* + re-auth |
| Network / `403` / `5xx` | *"Couldn't reach Are.na."* + retry. **Never** shown as "no connections." |
| *(phase 2)* Disabled / skipped | *"Lookup is off for this site."* + re-enable |

---

## 6. Privacy & security

**The manual model makes this section much cheaper**, and that is most of why
we chose it (§1.5). Nothing is sent unless you click. There is no background
traffic, no browsing history leaving the machine, and no permission warning at
install. The strongest privacy guarantee available here is structural: *the
extension cannot see a page you didn't ask it about.* Preserve that property.

Still true, and still ours to own:

- **Never send the full URL** — we send extracted word tokens, which is what the
  API needs and strictly less than the raw URL. Query strings and fragments never
  leave the machine, even on an explicit click.
- **Skip `localhost` and private IPs** unconditionally.
- **A click is attributable.** Queries go to Are.na with your bearer token, so
  each lookup associates *you* with *that page*. Say so plainly in the options
  page — it's a small disclosure now precisely because the surface is small.
- **The hit-rate counter (§1.5) is local-only** and never transmitted.
- **No third parties. Ever.** Notably: **do not use Google's favicon service** —
  the primer records shipping every browsed domain to Google while claiming
  otherwise. Fetch `https://<domain>/favicon.ico` directly, or skip favicons.
- No analytics, no telemetry, no remote config.

**When phase 2 (§1.5) lands, this section changes character**: ambient +
authenticated means continuous, attributable browsing history sent to Are.na.
That requires the `tabs` permission, a prominent first-run explanation before the
first lookup, a one-click global off, and a per-domain skip list — none of which
the MVP needs. Do not ship ambient without them.

**Untrusted content.** Block titles, descriptions, channel titles, and user names
are attacker-controllable strings written by strangers. Render exclusively with
`createElement` + `textContent`; never `innerHTML`. To reduce HTML to text, use
an inert document:

```ts
const stripHtml = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
```

**This is now the project's central threat.** Never-expiring, non-revocable
tokens plus rendering hostile HTML is precisely the combination the primer warns
about: one malicious block description exfiltrating a permanent credential. The
anonymous design didn't have this exposure; the v3 design does. Treat §6 as
load-bearing, not boilerplate.

`rel="noopener"` on every outbound link; token input `type="password"`,
`autocomplete="off"`. Extension-page CSP:
`default-src 'self'; connect-src https://api.are.na; img-src 'self' data: https:; object-src 'none'; base-uri 'none'`.

---

## 7. Build plan

### Step 0 — scaffold and contracts (sequential, blocking)

One agent alone lands `package.json`, `vite.config.ts`, `tsconfig.json`,
`public/manifest.json`, placeholder icons, `src/core/types.ts`,
`src/core/messages.ts`, and a compiling stub for each module. `npm run build`
must produce a `dist/` that loads unpacked and does nothing.

Nothing parallelizes until this is green — every workstream imports these types.

### Steps 1–6 — parallel workstreams

| # | Workstream | Owns | Depends on |
| --- | --- | --- | --- |
| 1 | **URL logic** | `core/url.ts` — normalize, domainLabel, buildQueries, classify | types |
| 2 | **Auth** | `core/auth.ts` — PAT storage first, then OAuth/PKCE; options sign-in UI | types |
| 3 | **API client** | `core/arena.ts` — v3 calls, parsing, error taxonomy, retry | types, auth iface |
| 4 | **Storage** | `core/cache.ts`, `core/settings.ts` (incl. local hit-rate counter) | types |
| 5 | **Background** | `background/service-worker.ts` — message router, `resolve.ts` orchestration | types, messages |
| 6 | **Popup** | `src/popup/*` — the only module that may touch `chrome.tabs` | types, messages |

File-exclusive boundaries, so agents don't collide. 5 and 6 code against the
contracts and mock core modules until they land.

Workstream 5 is much smaller than it would be for an ambient build — no tab
listeners, no debounce, no badge. **Enforce the §1.5 boundary here:** the service
worker and everything under `core/` must be tab-agnostic, taking URLs only.

Highest-value / most testable: **workstream 1.** Port
`docs/reference/resolver.py` faithfully and unit-test the failure cases —
`en.wikipedia.org` → `wikipedia`, the `wiki` stopword zeroing results, the
tracking-param URL. These fail silently in production if wrong.

Riskiest: **workstream 3's error taxonomy.** `401` vs `403` vs `429` vs `402`
mean different things and must never collapse into "no results" (§2.6, §5.3).

Do **stage 1 (PAT) of workstream 2 first** and land it early — everything else
needs a token to test against.

### Step 7 — integration (sequential)

Wire real modules into the SW and popup, replace mocks, manual-test the §8
matrix, then do OAuth (stage 2) once the PAT path is proven.

### Testing

- **Unit (vitest):** URL normalize/tokenize/classify, response parsers against
  recorded JSON fixtures, cache TTL/eviction, error taxonomy mapping.
- **Fixtures over live calls** in CI — live tests are flaky and need a secret.
- **Any probe script must set an explicit `User-Agent`** or it will produce
  phantom `403`s and mislead you, exactly as it did during planning (§2.6).

---

## 8. Getting it running locally

```bash
cd ~/Projects/Are.na-Browser-Extension
npm install
npm run build          # → dist/
npm run dev            # watch mode
```

Load into Chrome:

1. `chrome://extensions` → toggle **Developer mode**
2. **Load unpacked** → select `dist/`
3. Pin "Are.na Connections" from the puzzle-piece menu
4. Open the options page and paste a PAT from
   [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens)

Iterating:

- **Popup/options changes** — reopen the popup.
- **Service worker changes** — hit **Reload** (↻) on the extension card.
- **Manifest changes** — Reload, then re-check permissions.
- **Debug the SW**: extension card → "service worker" link → DevTools. MV3
  workers are evicted when idle, so never hold state in module-level variables —
  persist to `chrome.storage`.

Smoke matrix, all known-good/known-bad from §2:

Open each page, click the icon, expect:

| URL | Expect |
| --- | --- |
| `https://www.seangoedecke.com/llms-reward-expertise/` | 4 blocks, four channels |
| `https://www.robinsloan.com/lab/new-avenues/` | many blocks and channels |
| `https://en.wikipedia.org/wiki/Chicago_Lake_Tunnel` | clean "no connections found" |
| `https://ar.pinterest.com/pin/1688918604964037/` | "can't be looked up" |
| signed out | "Sign in to Are.na" |

Verify wiring before any UI exists (note the `User-Agent` — §2.6):

```bash
TOKEN=$(cat ~/.arena-token)

curl -s -H "Authorization: Bearer $TOKEN" -H 'User-Agent: arena-ext/0.1' \
  --get 'https://api.are.na/v3/search' \
  --data-urlencode 'query=seangoedecke llms reward expertise' \
  --data-urlencode 'type=Link,Embed,Image' --data-urlencode 'per=50' \
| python3 -m json.tool | head -40

curl -s 'https://api.are.na/v3/blocks/49233611/connections?per=10' | python3 -m json.tool
```

---

## 9. Risks

| Risk | Severity | Response |
| --- | --- | --- |
| **Premium requirement shrinks the audience to near-zero for sharing** | **High (product)** | Accepted deliberately (§2.2). Personal tool first. §10.2 keeps a non-Premium path open behind the `arena.ts` seam. |
| **Never-expiring token + hostile block HTML** | **High (security)** | §6 is load-bearing: `textContent` only, session-tier storage by default, strict CSP. This is the threat the anonymous design didn't have. |
| Free/non-Premium error response is unknown | Medium | §2.8 — test before building the signed-in-not-Premium state; it's a first-run path. |
| Recall gaps make it feel unreliable | Medium | Classify-and-skip unresolvable URLs (§2.5); honest copy (§5.3); under-promise. |
| Privacy — attributable browsing history sent to Are.na | **Low in MVP**, High at phase 2 | Manual lookup makes this structural: nothing is sent unless clicked, and `activeTab` means we cannot see unasked pages (§6). Re-rate before shipping ambient. |
| **Manual MVP is less compelling than the actual idea** | Medium (product) | Accepted knowingly (§1.5). Ambient is ~a day on top once the core is proven. Use the hit-rate counter to decide when. |
| Tab-centric assumptions leak into `core/`, making ambient a refactor | Medium | Contract-enforced: messages carry URLs, never tabIds; only the popup imports `chrome.tabs` (§4.3, §7). |
| MV3 service worker eviction | Low in MVP | All state in `chrome.storage`; nothing durable in module scope. Less exposure now that nothing runs in the background. |
| Are.na objects to the traffic pattern | Low | Well within documented limits (§2.6), honest UA, `read` scope. Reach out early — this is a project they'd plausibly like. |

---

## 10. After the MVP

1. **Ambient awareness + badge — the destination (§1.5).** Add
   `tabs.onActivated`/`onUpdated`, a 1.2s debounce, active-tab-only gating, and
   badge management on top of the existing message path. Requires upgrading
   `activeTab` → `tabs`, which brings the *"Read your browsing history"* warning,
   so it must ship together with the §6 disclosure, a global off switch, and a
   per-domain skip list. Everything below the popup already works unchanged.
   **Gate the decision on the hit-rate counter** — if most pages you check have
   no connections, an ambient badge is mostly-empty noise and the honest move is
   to keep it manual.
2. **In-page indicator** — a small floating affordance on connected pages, in a
   shadow root to avoid site CSS collisions. Only worth it after ambient, since
   it depends on knowing about connections without being asked.
3. **Non-Premium fallback.** The gated call is *only* discovery (§2.3), and the
   `arena.ts` search seam is designed for this swap. Options, roughly in order of
   preference: ask Are.na whether a limited public URL-lookup is possible;
   community-run index; or anonymous v2 search as a degraded mode, with its
   deprecation risk stated in the UI. Worth revisiting once the thing exists and
   is demonstrably good.
4. **Your own connections** — with auth already in place, marking "you saved
   this" and showing private/closed-channel connections is nearly free.
5. **Channel-level browsing** — walk from a channel into its other blocks without
   leaving the popup.
6. **Domain view** — "23 pages from this domain are on Are.na," which the bare
   domain-label query already supports.
7. **Save to Are.na** — only if the official extension proves insufficient. Needs
   `write` scope and re-consent.
8. **Firefox** — MV3 there is close enough that the port is mostly manifest work.

---

## Appendix — quick reference

```
Search:       GET https://api.are.na/v3/search?query=<tokens>&type=Link,Embed,Image&per=50
              Authorization: Bearer <token>          (Premium required)
Connections:  GET https://api.are.na/v3/blocks/{id}/connections?per=10     (public)
Block:        GET https://api.are.na/v3/blocks/{id}                        (public)
Identity:     GET https://api.are.na/v3/me                                 (Bearer)
Spec:         https://api.are.na/v3/openapi.json
Web URLs:     are.na/{user} · are.na/{user}/{channel} · are.na/block/{id}
```

Gotchas, condensed: `/v3/search` needs Premium · pass **word tokens, not URLs** ·
queries are conjunctive, so more tokens = fewer results · drop stopword path
segments (`wiki` alone zeroes a query) · use the registrable domain label, not
the first · channel owner is `owner` not `user` · don't re-sort connections ·
`403` can mean CDN rejection, never "no results" · set a `User-Agent` in probe
scripts · tokens never expire and can't be revoked via API.
