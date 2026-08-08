# iOS Safari extension — WS3 spike findings

Run 2026-08-08 against the converter-generated iOS target in `apple/`,
iPhone 15 Pro Simulator, **iOS 17.2**. No Apple Developer Program membership
is needed for Simulator work.

**Verdict: it works, unchanged.** The same `dist/safari` build that runs in
Safari on macOS loads, enables, and renders on iOS. No iOS-specific code was
needed. What follows is what the spike actually observed against the four
risk areas the plan flagged, plus two issues worth fixing.

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

### 3. Lifecycle — not exercised

The plan's concern was iOS aggressively killing the background page
mid-lookup. Confirming that needs a signed-in session (see *Not tested*
below), so it remains open. The reasoning behind the original assessment
still holds: the in-memory maps in `background/service-worker.ts` are dedupe
caches, and `core/cache.ts` already persists to storage, so the worst case
should be a retap rather than data loss.

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
- [ ] OAuth sign-in on iOS (the flow is proven on macOS; the open question is
      whether Safari returns cleanly to the popup afterward)
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
