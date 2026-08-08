# iOS Safari extension — WS3 spike findings

Run 2026-08-08 against the converter-generated iOS target in `apple/`,
iPhone 15 Pro Simulator, **iOS 17.2**. No Apple Developer Program membership
is needed for Simulator work.

Also re-run 2026-08-08 on **iOS 26.5** (iPhone 17) for the OAuth work below;
behaviour matched 17.2, so the old runtime was not hiding anything.

**Verdict: the extension works on iOS; OAuth sign-in does not.** The same
`dist/safari` build that runs in Safari on macOS loads, enables, and renders
on iOS with no iOS-specific code. OAuth is a genuine lifecycle failure (risk
area 3) and is **pinned** — token paste-in is the iOS sign-in path. What
follows is what the spike observed against the four risk areas, plus two UI
issues worth fixing.

## How to reproduce

```sh
npm run build:safari
xcodebuild -project "apple/Are.na Connections/Are.na Connections.xcodeproj" \
  -scheme "Are.na Connections (iOS)" -configuration Debug \
  -destination "id=<simulator-udid>" -derivedDataPath /tmp/arena-ios-build \
  build CODE_SIGNING_ALLOWED=NO
xcrun simctl install <simulator-udid> \
  /tmp/arena-ios-build/Build/Products/Debug-iphonesimulator/"Are.na Connections.app"
```

Then, in the Simulator: launch the wrapper app once (it shows a "turn this on
in Settings" screen — that's the whole app, by design), then **Settings →
Safari → Extensions → Are.na Connections → Allow Extension**, and set the two
per-site permissions to Allow. Open Safari, tap **AA** in the address bar, and
pick **Are.na Connections**.

Simulator quirk: the **Allow Extension** toggle ignores synthetic taps. Drag
it (a short horizontal swipe) instead. Real devices are unaffected.

## The four risk areas

### 1. Distribution — unchanged, still the blocker

iOS extensions ship only inside an App Store app: Apple Developer Program
($99/yr) plus App Review. The converter's wrapper app is a single "enable me
in Settings" screen, which is the norm for Safari Web Extensions and is
sufficient as-is. Nothing about the spike changes this; it remains the one
hard gate, and it gates only *distribution*, not development.

### 2. UI — works, two issues

The popup presents as a **sheet**, opening at roughly half height and
expanding to full height on drag. Verified at both detents:

- No double scrollbar, no clipped content, no horizontal overflow.
- Text is legible; the 16px input minimum (added in WS2) does prevent
  focus zoom.
- **The dual sign-in card renders correctly** — OAuth button, "Or paste an
  access token" label, input, and Connect button all laid out sensibly
  together. This was its first render on any platform.

Two issues found:

- **`.auth-remember` checkbox is far below the 44px touch minimum** —
  roughly 17pt as rendered. This is the item WS2 explicitly deferred because
  the checkbox lives in `src/styles/auth-card.css`, which that workstream
  didn't own. iOS confirms it's a real problem, not a hypothetical one.
  Fixing it means sizing the checkbox in `auth-card.css`, which affects
  Chrome and Firefox too — hence still worth doing deliberately rather than
  as a drive-by.
- **Large empty gap above the content at full-height detent.** `.auth-view`
  centers vertically, which reads fine in a sidebar and looks odd in a
  full-height sheet. Cosmetic only. Target-scope any fix to `popup-mode` so
  the sidebar layout is untouched.

### 3. Lifecycle — **this is the real problem, and it breaks OAuth**

Confirmed 2026-08-08: **OAuth sign-in does not complete on iOS.** Tapping
"Sign in with Are.na" opens the auth tab, and the flow then dies silently —
reopening the popup shows the sign-in card again, with no token and no error.

The mechanism:

1. Opening the auth tab **dismisses the popup sheet**, destroying that page.
2. With no UI attached, iOS suspends the non-persistent background page.
3. The original flow registered `tabs.onUpdated` **dynamically** and held the
   PKCE verifier, `state`, and promise resolvers **in memory**. Suspension
   took all of it. Nothing was left to catch the redirect.

macOS Safari worked only because its background page happens to stay alive
for the duration — that was luck of timing, not design.

**What was changed** (commit "Make the OAuth flow survive background
suspension"): the flow is now split into `beginOAuth` / `completeOAuth` in
`core/auth.ts`. `beginOAuth` persists `{verifier, state, redirectUri,
remember}` to `storage.session` and returns the authorize URL;
`completeOAuth` reads that record back and finishes the exchange, sharing no
closure with the code that started it. The `tabs.onUpdated` listener is now
registered at the **top level** of `background/service-worker.ts` via
`platform.registerAuthCallback`, which is the only shape a browser can use to
revive a suspended background page. Covered by six tests in
`test/auth.test.ts` (persistence, `remember` across the gap, state mismatch,
wrong redirect, replay rejection, no-pending-flow).

**This fixes macOS robustness but is NOT yet confirmed to fix iOS.** A direct
probe — navigating a tab to the redirect URL with both host permissions
granted and the rebuilt extension installed — did **not** cause the extension
to close the tab, meaning the top-level listener did not fire. On this
evidence iOS does not appear to revive a suspended background page for
`tabs.onUpdated`.

Caveat on that probe: it tests a *cold* background, the hardest case. In the
real flow the background is warm when the tab opens, so it may still complete.
That distinction is untested.

### The content-script attempt — tried, reverted, pinned (2026-08-08)

The obvious next move was a **content script** on the redirect URL that reads
`location.href` and `runtime.sendMessage`s it to the background, on the theory
that message delivery revives a suspended background page where a `tabs` event
does not. It was built and then reverted. Both reasons matter:

1. **It did not demonstrably work.** The same probe on **iOS 26.5** (a current
   runtime, not just 17.2) still did not fire. Inconclusive rather than
   disproven — a content script needs its per-site permission granted and may
   need a Safari relaunch after reinstall, and neither was established
   reliably through Simulator automation. But unverified is unverified.
2. **It made the permission story worse, not better.** Because content scripts
   inject into pages, iOS 26 relabels the extension from *"Browsing History —
   can see your browsing history on the current tab's webpage"* to:

   > **Webpage Contents and Browsing History** — Can read and alter sensitive
   > information on webpages, including passwords, phone numbers, and credit
   > cards…

   `jsplitlog.github.io` also *still* appeared as a per-site entry, so moving
   it out of `host_permissions` shrank nothing. For an extension whose whole
   premise is that it only looks something up when you ask, that trade is bad.

**Decision: iOS is pinned.** macOS Safari stays on the `tabs.onUpdated` path,
which is where it was last known to work. iOS ships as-is — the extension
installs, enables, and renders correctly there; **OAuth sign-in does not
complete, and token paste-in is the iOS sign-in path.**

If iOS OAuth is picked up again, the options are: verify the content-script
approach on a real device (Simulator automation was not good enough to settle
it), or drop Safari OAuth entirely and keep token paste-in on both Safari
platforms, which needs no hosted page, no content script, and no second
permission. The `beginOAuth`/`completeOAuth` split stays either way — it is a
correctness fix for how the flow held state, independent of any of this.

Unrelated to OAuth, the original lifecycle assessment still holds for lookups:
the in-memory maps in `background/service-worker.ts` are dedupe caches and
`core/cache.ts` persists to storage, so a mid-lookup termination should cost
a retap rather than data.

### 4. Per-site permissions — small, but OAuth doubled it

The permission sheet lists exactly two hosts, both defaulting to **Ask**:

```
api.are.na            Ask
jsplitlog.github.io   Ask
```

Worth naming plainly: **wiring Safari OAuth through GitHub Pages doubled the
iOS prompt surface.** Before that, `api.are.na` was the only host. The second
entry exists solely so `tabs.onUpdated` can see the OAuth callback. It's a
genuine cost of the Pages approach that only becomes visible on iOS, where
per-site permissions are surfaced to users prominently. Still a small surface
— two domains, both explicable — but it's no longer one.

Also note the permission is described to users as **"Browsing History — can
see your browsing history on the current tab's webpage when you use the
extension."** That's iOS's stock wording for `activeTab`, and it sounds
broader than what the extension does. Nothing to fix in code; worth knowing
it's what users read.

## Not tested — needs j

Everything past the sign-in card requires authenticating as the account
owner, which no agent should do:

- [ ] Lookup hit / miss on a real page
- [ ] Connections expand
- [x] OAuth sign-in on iOS — **fails**, see risk area 3 above. Retest after
      any further fix; token paste-in is the working iOS path today.
- [ ] Token paste-in
- [ ] Sign-out, and "Remember device" persistence across an app restart
- [ ] Background-termination behavior mid-lookup (risk area 3)

## Go / no-go on App Store submission

**Technically: go — the work is done.** The extension runs on iOS with no
iOS-specific code, and the wrapper app the converter generated is
submission-shaped already.

**Practically: not worth it yet.** Submission costs $99/yr plus App Review,
and buys nothing that isn't already available by running it locally. The two
UI issues above should be fixed first regardless, and Mozilla-style source
disclosure has an Apple analogue in review scrutiny of a near-empty wrapper
app — those apps are approved routinely, but expect questions about what the
app itself does.

Recommendation: fix the touch target and the sheet gap, leave submission
until someone other than j wants it on their phone.
