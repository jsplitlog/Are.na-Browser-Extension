# Implementation brief — Are.na Connections extension

> **Historical implementation brief.** The popup implementation it describes is
> preserved at commit `ca6ff63`. The current side-panel requirements and commit
> sequence live in [`sidebar-rewrite-plan.md`](./sidebar-rewrite-plan.md).

**This file is the handoff prompt.** It carries context and decisions from the
planning session that aren't recoverable from the code or the plan alone. Read it
first, then the plan.

---

## Your task

Implement the Chrome extension specified in
`/Users/j/Projects/Are.na-Browser-Extension/docs/design-and-development-plan.md`,
following the build order in its §7, and get it running unpacked in Chrome on
this machine.

## Read these first, in order

| Path | What it is |
| --- | --- |
| `docs/design-and-development-plan.md` | **The spec.** Complete: product, architecture, contracts, UI, build order, local setup. Every §-reference below points here. |
| `docs/reference/resolver.py` | **Executable spec** for the resolver. Validated against the live API. Port it to TypeScript faithfully; its fixtures become your unit tests. Run `python3 resolver.py` for offline checks, `--live <url>` for a real lookup. |
| `docs/arena-api-primer.md` | Prior-art notes from an earlier Are.na project. Useful on OAuth/PKCE and data shapes. **Partly superseded** — see "Where the primer is wrong" below. |

## What we're building, in one paragraph

Are.na's data model lets the same URL live in many people's channels at once. No
tool surfaces that. This extension answers "who else on Are.na has saved this
page?" — you click the toolbar icon, it resolves the current URL to Are.na
block(s), and lists the public channels holding it, with owner and channel title,
linking out to are.na. The destination is ambient (a badge that lights up as you
browse); the MVP is deliberately click-to-check (§1.5).

---

## Decisions already made — do not relitigate

Each was argued through with the user. If you think one is wrong, **say so and
wait** — don't quietly build the alternative.

1. **API: v3, authenticated, Premium required.** Not v2. v2 is deprecated
   ([dev.are.na](https://dev.are.na) says so) and its anonymous search was a
   workaround around a paywall Are.na put up deliberately. Costs nothing in
   recall — measured 88% both ways, agreeing on every test URL (§2.2, §2.5).
2. **Manual lookup for the MVP; ambient is phase 2.** Reasons are permissions
   (`activeTab` shows no warning; `tabs` shows *"Read your browsing history"*)
   and privacy now that we require sign-in. **Not** rate limits (§1.5).
3. **Vite + TypeScript, vanilla DOM.** No React. No `@crxjs/vite-plugin` — static
   `public/manifest.json` + explicit Rollup inputs (§3).
4. **Read-only, `read` scope.** No saving to Are.na; the official extension does
   that (§1.3).
5. **PAT first, OAuth+PKCE second.** Don't block the data path on OAuth (§4.7).
6. **Two-phase lookup retained** even though nothing forces it today — it's what
   makes phase 2 additive (§4.2).

### The constraint that protects phase 2

`resolve.ts` takes a **URL**. The cache keys on **normalized URL**. Messages
carry `{ url }`, never `tabId`. **Only `src/popup/` may import `chrome.tabs`.**

If tab-centric assumptions leak into `core/` or the service worker, adding
ambient becomes a refactor instead of an addition. This is the single most
important structural rule in the build.

---

## Environment (verified this session)

- Working dir: `/Users/j/Projects/Are.na-Browser-Extension` — macOS, Chrome installed.
- `node v26.5.1`, `npm 11.17.0`, `git 2.55.0`.
- **Not a git repo yet.** Run `git init` and add a `.gitignore`
  (`node_modules/`, `dist/`, `*.local`) during step 0. **Do not commit unless the
  user asks.**
- Repo currently contains only `docs/`. Everything else is yours to create.
- **Token:** a PAT may exist at `~/.arena-token` (mode 0600). The user was
  advised to rotate it, so **verify before relying on it**:
  ```bash
  curl -s -H "Authorization: Bearer $(cat ~/.arena-token)" \
       -H 'User-Agent: arena-ext/0.1' https://api.are.na/v3/me
  ```
  Expect JSON with `slug` and `badge`. On `401`, ask the user for a fresh token
  from [are.na/settings/personal-access-tokens](https://www.are.na/settings/personal-access-tokens).
  Never commit it, never paste it into a file in the repo, never echo it.

---

## Traps — things that will silently break

Every one of these was hit during planning. They fail *quietly* — wrong results,
not errors — which is why they're listed rather than left to discovery.

1. **Never send a URL as the search query.** `/v3/search` accepts it and returns
   fuzzy garbage (200 OK, ~10000 irrelevant results). Send extracted word tokens
   (§2.4).
2. **Search is conjunctive — more tokens means fewer results.** One junk token
   zeroes the whole query. `wikipedia wiki Walter Van Beirendonck` → **0
   results**; drop the `wiki` stopword → finds it. Maintain the stopword list and
   the 4-token cap (§2.4).
3. **Domain label is the *registrable* label, not the first.**
   `host.split('.')[0]` gives `en` for `en.wikipedia.org` and poisons the query.
4. **Channel owner is `owner`, not `user`.** Getting this wrong silently degrades
   every are.na link to the fallback URL form. The primer shipped this bug once.
5. **Don't re-sort connections.** The API returns them in connection order;
   `created_at` on each item is the *channel's* creation date, not the
   connection's.
6. **`403` never means "no results."** It can be throttling *or* CDN rejection.
   Map errors deliberately — `401` vs `402` vs `403` vs `429` mean different
   things and must not collapse into an empty state (§4.5, §5.3).
7. **Any probe script you write must set an explicit `User-Agent`.** Python's
   default `Python-urllib/x.y` is rejected at Are.na's CDN with a `403` that
   looks exactly like rate limiting. This produced a wrong finding during
   planning that survived into a draft of the plan. Chrome extensions are
   unaffected (`fetch` sends Chrome's UA; `User-Agent` is a forbidden header
   anyway).
8. **Render only with `createElement` + `textContent`.** Block titles,
   descriptions, channel titles, and usernames are attacker-controlled strings
   from strangers. Combined with never-expiring, non-revocable Are.na tokens,
   `innerHTML` is a credential-exfiltration path. This is the project's central
   security threat (§6).

---

## Rate limits are not a constraint — don't design around them

Measured: 30 authenticated searches back-to-back, no delay → 30/30 `200`.
Premium floor is 300/min; a lookup costs ~2–10 requests. Keep the modest
discipline in §4.5 (concurrency 3, 10-request cap, in-flight dedupe) and don't
add queues, delays, or backoff schedules beyond what's specified. An earlier
draft over-engineered this based on the §2.6 error.

---

## Where the primer is wrong

`docs/arena-api-primer.md` is a good document from a different project. Two of
its claims don't hold here:

- **"Use v3 exclusively"** — correct, but it doesn't mention that `/v3/search` is
  Premium-gated, which is the central constraint of this project (§2.2).
- **"v2 is still up"** — stale. v2 is now deprecated.

Its OAuth/PKCE guidance (§3), data-shape accessors (§6), and security lessons
(§7) are still good and worth following.

---

## Build order

Follow §7. Compressed:

**Step 0 (blocking, do alone):** scaffold — `package.json`, `vite.config.ts`,
`tsconfig.json`, `public/manifest.json`, placeholder icons, `src/core/types.ts`,
`src/core/messages.ts` (both verbatim from §4.3), plus a compiling stub for every
module in §3's tree. `npm run build` must produce a `dist/` that loads unpacked
and does nothing. Also `git init` + `.gitignore`, and vitest wired up.

**Then, in parallel** (file-exclusive, no collisions):

| # | Workstream | Owns |
| --- | --- | --- |
| 1 | URL logic | `core/url.ts` |
| 2 | Auth | `core/auth.ts` + options sign-in UI |
| 3 | API client | `core/arena.ts` |
| 4 | Storage | `core/cache.ts`, `core/settings.ts` |
| 5 | Background | `background/service-worker.ts` |
| 6 | Popup | `src/popup/*` |

Land **workstream 2 stage 1 (PAT)** early — everything else needs a token to test
against. Workstream 1 is the highest-value and most testable. Workstream 3's
error taxonomy is the riskiest.

**Then:** integrate, run the §8 smoke matrix, then OAuth (stage 2).

---

## Resolve these early — they're unknowns, not guesses

1. **What does `/v3/search` return for a signed-in *free* (non-Premium) account?**
   `402`, `403`, or empty results? This determines a first-run error state
   (§5.3). Only a supporter token was tested. Ask the user if you can't test it.
2. **Does `type=Link,Embed,Image` beat `type=Link`** on embed-heavy URLs
   (YouTube/Vimeo)? Unresolved — the test URL wasn't on Are.na. It's one tunable
   constant (§2.4).
3. **`chrome.storage.local` behavior** past a few thousand cache entries.

---

## Definition of done for the MVP

- Loads unpacked in Chrome with no errors in the service worker console.
- Sign in with a PAT via the options page; `/v3/me` confirms identity.
- Clicking the icon on `https://www.seangoedecke.com/llms-reward-expertise/`
  shows **4 blocks** and these four channels:
  `connor-geiman/good-stuff-for-llms`, `laurence-ininda/ai-software-development`,
  `dajb/tech-kfn6yqfv1qy`, `om-jha-ei_kihogzrq/summer-2026-0htvkkmjjwe`.
- The rest of the §8 smoke matrix behaves (the current Wikipedia miss fixture → clean "none found";
  Pinterest → "can't be looked up"; signed out → sign-in prompt).

> **Live-data update (2026-08-05, implementation):** The original
> `Brutalist_architecture` negative fixture now resolves to four exact blocks.
> It was replaced in §8 with `Chicago_Lake_Tunnel`, confirmed as a clean miss by
> both the TypeScript implementation and `resolver.py`.

> **Resolver update (2026-08-05, implementation):** A real false negative at
> `negative.sanctuary.computer/` showed that useful subdomain words must count
> during preflight. Classification now counts useful hostname + path tokens, and
> root-page queries include meaningful subdomains before falling back to the
> registrable label. Block `49271337` is the regression case.

> **UI update (2026-08-05, implementation):** Results now open the exact matching
> canonical block URL (`/block/{id}`), because Are.na does not expose a durable
> external URL for its in-app block-over-channel state. Popup/options styling was
> reduced to a fixed-width white utility surface with a minimal type hierarchy.

> **Style-source update (2026-08-05, implementation):** Popup and PAT settings
> styles are adapted from official `aredotna/ervell` commit
> `2fcb6d2b85b4d6fbe6cd1a36641aac2d91955c47`, using its production color, type,
> spacing, input, checkbox, button, settings, channel-row, and divider sources.

> **Sorting update (2026-08-05, implementation):** Discrete copies can be sorted
> by most connections, least connections, newest, or oldest. Date sorting uses block
> `created_at` (the originating connection); later connection timestamps are not
> exposed by the API.

> **Date-display update (2026-08-05, implementation):** Each copy row shows its
> block `created_at` date beside the creator. Dates are locale-formatted with a
> UTC calendar and never use `updated_at`.

> **Result-model update (2026-08-05, implementation):** The popup is block-first:
> one row per discrete matching block ID. Connection count and a short channel
> summary are secondary metadata. Creator avatar/name replace the visible block
> ID. This prevents one multiply-connected block
> from producing several rows that all point to the same destination.

> **Connection-presentation update (2026-08-05, implementation):** The side
> panel still keeps one row per matching block ID, but leads each row with its
> originating channel rather than the repeated block title. The heading sums
> each block's complete connection total across all matching instances.

> **Build update (2026-08-05, implementation):** Vite's optional module-preload
> generation is disabled because Chrome rejects extension-page preload hints as
> cross-world resources. Native module imports preserve code splitting without
> the warnings.
- Unit tests pass, including the `resolver.py` fixtures ported over — especially
  the `wiki`-stopword and `en.wikipedia.org` regressions.
- Second click on the same page is served from cache with no network request.
- No `innerHTML` anywhere. No `chrome.tabs` outside `src/popup/`.

## Rules of engagement

- **Check in before**: deviating from a §"Decisions already made" item; adding a
  runtime dependency beyond Vite/TypeScript/vitest; committing or pushing;
  anything touching the user's token beyond reading `~/.arena-token`.
- **Just do**: everything else in the plan. Don't ask permission to write the
  code you were asked to write.
- **If the plan is wrong**, say so plainly, propose the fix, and — unless it
  blocks you — keep building the rest. The plan has been revised twice already;
  it is not sacred.
- **Update the plan** when you learn something that contradicts it, especially in
  §2.8 ("verified vs. assumed"). The next agent reads it as fact.
