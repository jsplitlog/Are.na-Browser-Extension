# UI Refresh Plan — migrating to are.na's current design tokens

Status: draft — 2026-08-07
Owner: j
Companion to: `docs/cross-browser-plan.md` (any restyle lands on all three
targets at once now)

## Verdict: the suspicion is correct

The extension's theme (`src/styles/arena-theme.css`) — and the Figma file
driving it — encode are.na's **previous** design. The current site (inspected
live at www.are.na on 2026-08-07) runs a redesigned token system that differs
in every category j flagged: color, font, and size.

How the current values were obtained: are.na uses Stitches with theme classes;
the full `--colors-*` / `--fontSizes-*` / `--space-*` custom-property sets for
all four shipped themes (light, dark, plus two alt themes — a warm
"tan" light and a "lavender" dark) were read out of the live site's CSSOM.
They are reproduced in full in the appendix below, so nothing in this plan
requires re-scraping the site.

### The three tells

1. **The cyan is gone.** `--arena-blue: #00bbf7` has no counterpart anywhere
   in the current system. Are.na's blues are now navy `#00075F` (brandDark),
   indigo `#3D46C2` (focus), and pale `#EBECF7` (brandLight). The site's only
   saturated action color is the navy (e.g. the Sign up button,
   `background: #00075F`).
2. **Closed channels are no longer purple.** The extension renders closed
   channels in `#4b3d67`. Current are.na maps `channelClosed1/2/3` to the
   *gray* ramp (`gray1`/`gray3`/`gray6`) — closed is neutral now. Open/public
   moved from `#17ac10` to `#238020` (light) / `#98DC89` (dark); private moved
   from `#b60202` to `#B93D3D` / `#EB6864`. Status *backgrounds* are discrete
   tint tokens (`green1`, `red1`, …), not the alpha blends the extension
   computes.
3. **The font is now a custom face.** Body text renders in `areal`, a custom
   woff2, with a metric-tuned local Arial fallback
   (`size-adjust: 100.76%; ascent-override: 87.13%`). The extension's
   Arial-first stack is exactly are.na's fallback behavior — visually close,
   but not identical.

### Where the Figma file stands

The open Figma file (Modal frame, Sign=In / Sign=Out variants) was read via
the Figma MCP. Its primitives are **identical to the extension's current
(old) values** — `--fg #333`, `--fg-secondary #585858`, `--fg-muted #999`,
`--border #eee`, `--surface #f7f7f7`, `--input-bg #f7f5f4`, Arial, radius
4/8. So Figma and code agree with each other and are stale *together*; the
Figma file documents the extension, it does not contradict it. Two Figma
values have no are.na counterpart and need explicit decisions:

- `--success: #22c55e` (Tailwind green-500) — are.na's green is `#238020`.
- `--accent: #333333` — consistent with the new grayscale direction, fine.
- `shadow/elevated` (3-layer drop shadow) — are.na uses a single soft
  `0 0 20px rgba(0,0,0,0.08)`; keep Figma's if the modal design wants more
  lift, it's a component decision not a token.

**Process rule for this migration:** the live site is authoritative for
*primitive* tokens (colors, type ramp, spacing, radius); the Figma file stays
authoritative for *component* decisions (modal layout, hierarchy, control
sizes). Step 1 below updates Figma's variables to the new primitives so both
sources move together and the Figma designs re-render on the new palette
before any CSS is written.

## Token migration map

All changes land in `src/styles/arena-theme.css`; consumers reference
semantic vars and mostly don't change. Old → new:

### Light

| Variable | Old | New | are.na token |
| --- | --- | --- | --- |
| `--arena-black` | `#333` | `#333` (keep) | gray6 / link |
| `--arena-text` | `#585858` | `#696969` | gray5 / slate |
| `--arena-muted` | `#999` | `#999` (keep) | gray4 |
| `--arena-line` | `#eee` | `#EDEDED` | gray2 |
| `--arena-soft` | `#f7f7f7` | `#F7F7F7` (keep) | gray1 |
| `--arena-surface` | `#fff` | `#FFF` (keep) | gray0 / background |
| `--arena-input` | `rgb(247,245,244)` | `#F7F7F7` | gray1 (the warm off-white is old) |
| `--arena-control-border` | `#ccc` | `#DEDEDE` | gray3 |
| `--arena-control-active` | `#999` | `#999` (keep) | gray4 |
| `--arena-blue` | `#00bbf7` | `#3D46C2` | focus (blue2) — only used for focus outline + accent-color, which is exactly this token's job |
| `--arena-channel-open` | `#17ac10` | `#238020` | channelPublic3 (green3) |
| `--arena-channel-open-background` | green @2.5% | `#F4F8F3` | channelPublic1 (green1) |
| `--arena-channel-open-active-background` | green @7% | `#B4D6B3` @~35% or green1→green2 step | channelPublic2 |
| `--arena-channel-closed` | `#4b3d67` | `#333` | channelClosed3 = gray6 (**purple retired**) |
| `--arena-channel-closed-background` | purple @2.5% | `#F7F7F7` | channelClosed1 = gray1 |
| `--arena-channel-closed-active-background` | purple @7% | `#DEDEDE` @~50% or gray1→gray3 step | channelClosed2 = gray3 |
| `--arena-channel-private` | `#b60202` | `#B93D3D` | channelPrivate3 (red3) |
| `--arena-channel-private-background` | red @2.5% | `#FAF4F3` | channelPrivate1 (red1) |
| `--arena-channel-private-active-background` | red @7% | red1→red2 step | channelPrivate2 |

For the `-active-background` rows: are.na's system has only two background
steps (1 = resting tint, 2 = strong tint). Recommend resting = token 1,
`:active` = token 2 at reduced alpha (e.g. `color-mix(in srgb, <token2> 40%,
<token1>)`) if full token 2 is too loud in the dense panel — judge visually
in T3.

### Dark

| Variable | Old | New | are.na token |
| --- | --- | --- | --- |
| `--arena-black` | `#d3d3d3` | `#E5E5E5` | gray6 / link |
| `--arena-text` | `#d3d3d3` | `#B2B2B2` | gray5 / slate (are.na separates title vs body in dark; extension currently doesn't) |
| `--arena-muted` | `#6e6e6e` | `#696969` | gray4 |
| `--arena-line` | `#2f2f2f` | `#333333` | gray2 |
| `--arena-soft` | `#131313` | `#1A1A1A` | gray1 |
| `--arena-surface` | `#000` | `#000` (keep) | gray0 |
| `--arena-input` | `#080a0b` | `#1A1A1A` | gray1 |
| `--arena-control-border` | `#444` | `#4F4F4F` | gray3 |
| `--arena-control-active` | `#6e6e6e` | `#696969` | gray4 |
| `--arena-blue` | `#17b0e2` | `#5E6DEE` | focus (blue2) |
| `--arena-channel-open` | `#2ba425` | `#98DC89` | green3 |
| `--arena-channel-open-background(s)` | alpha blends | `#121D12` / `#2A4C29` | green1 / green2 |
| `--arena-channel-closed` | `#d3d3d3` | `#E5E5E5` | gray6 |
| `--arena-channel-closed-background(s)` | alpha blends | `#1A1A1A` / `#4F4F4F` | gray1 / gray3 |
| `--arena-channel-private` | `#e24937` | `#EB6864` | red3 |
| `--arena-channel-private-background(s)` | alpha blends | `#1A0404` / `#412020` | red1 / red2 |

### Type, spacing, radius (decisions, not mechanical)

Current are.na (16px root): font sizes `12.5 / 14.4 / 16 / 19.2 / 24 / 28 /
32 / 40 / 48` px; spacing on a **5px grid** (5/10/15/20/25/35/45/65/80/100/130
+ 2px nudge); radius `3px`; pill and round radii for avatars/chips.

Extension today (`html { font-size: 20px }` trick): effective sizes
`11.25 / 12.5 / 13.75 / 15 / 16.25 / 17.5` px; 4px spacing grid; radius
5px effective.

Recommendation: the side panel is legitimately denser than the site, so do
**not** blindly adopt the site ramp. Minimal alignment that removes the
"off" feeling:

- Radius `0.25rem` (5px) → `3px` — this is very visible on buttons/inputs
  and is the cheapest win.
- Keep the compact size ramp, but snap the two most-compared sizes to
  are.na's: UI/button text → `12.5px` equivalent (are.na buttons are 12.5px
  bold; extension buttons are 15px regular — this is the biggest "size
  application" drift), title → keep 17.5px (between are.na's 16 and 19.2,
  fine in a panel).
- Button weight: are.na buttons are **700**; extension buttons are regular.
  Adopt bold.
- Spacing: leave the 4px grid alone this pass (a 5px re-grid touches every
  layout rule for marginal visible gain; revisit only if a side-by-side
  still reads wrong after color/radius/weight land).

### Font

`areal` is are.na's proprietary webfont; we should not bundle it. But its
fallback is metric-tuned Arial, so adopt the same trick for near-parity:

```css
@font-face {
  font-family: "areal fallback";
  src: local("Arial");
  ascent-override: 87.13%; descent-override: 20.84%;
  line-gap-override: 0%; size-adjust: 100.76%;
}
```

and lead the stack with it. Zero bytes shipped, matches the site's rhythm
when areal itself isn't available (which for us is always).

## Workstreams

Small enough for one agent each; T1 gates T2/T3.

### T0 — Figma sync (with j in the loop)

Update the Figma file's variables to the new primitives (table above):
`--fg-secondary` → `#696969`, `--border` → `#EDEDED`, `--input-bg` →
`#F7F7F7`, `--radius` → 3, `--success` → `#238020` (pending j's call),
add `--focus #3D46C2` / `--brand #00075F`. The Modal (Sign=In/Sign=Out)
components re-render on the new palette; j reviews there **before** any CSS
changes, and any component-level adjustments j makes in Figma get folded
into T2. Doable via the Figma MCP write tools against the open file, or by
hand if j prefers.

### T1 — Token remap in `arena-theme.css`

Apply both tables above. Pure value swap plus: replace the computed alpha
`-background` values with the discrete tint tokens; add the metric-tuned
Arial fallback @font-face; radius → 3px. No selector changes. Acceptance:
vitest green (no test asserts colors today — confirm), visual diff of the
panel in light+dark against `docs/` reference screenshots taken before the
change.

### T2 — Size/weight applications + auth card against Figma

- Buttons/controls: 700 weight, 12.5px-equivalent size, radius from token.
- Re-check `auth-card.css` (`.auth-link { font-size: 15px }` and friends —
  it has hardcoded px values that bypass the ramp) against the updated
  Figma Modal designs; reconcile hardcoded values back onto tokens.
- `--arena-control-height` recomputes from the new UI size — verify inputs
  don't shrink below touch-target minimums (iOS work in the cross-browser
  plan requires ≥44px targets and 16px inputs; do not regress that).

### T3 — Visual QA across targets

Side-by-side against live are.na (light + dark): channel rows for all three
statuses, buttons, inputs, focus states. Then the per-browser smoke passes
from `docs/cross-browser-plan.md` — Chrome, Firefox sidebar, Safari popup —
since this is the first restyle landing on all three targets. Screenshot the
before/after into `docs/`.

## Decisions for j

1. **Closed-channel gray**: adopting it means closed and "plain text" rows
   look alike at a glance (as on current are.na). OK, or keep a subtle
   differentiator?
2. **`--success`**: Figma's `#22c55e` vs are.na's `#238020`. Recommend
   `#238020` for coherence.
3. **Alt themes**: are.na ships tan-light and lavender-dark themes. Skip, or
   add later as a settings toggle? (Token structure after T1 makes this
   cheap; recommend skip for now.)
4. **T0 mechanics**: agent writes Figma variables via MCP, or j updates the
   file by hand?

## Appendix — are.na current tokens (captured 2026-08-07)

Light (`:root`): gray0 `#FFF`, gray1 `#F7F7F7`, gray2 `#EDEDED`, gray3
`#DEDEDE`, gray4 `#999`, gray5 `#696969`, gray6 `#333`, gray7 `#000`; red1
`#FAF4F3`, red2 `#DFBEBE`, red3 `#B93D3D`; green1 `#F4F8F3`, green2
`#B4D6B3`, green3 `#238020`; blue1 `#EBECF7`, blue2 `#3D46C2`, blue3
`#00075F`; alert `#E15100`; notification `#A87253`; foregroundShadow
`rgba(0,0,0,.08)`.

Dark (`.t-fCSbPT`): gray0 `#000`, gray1 `#1A1A1A`, gray2 `#333`, gray3
`#4F4F4F`, gray4 `#696969`, gray5 `#B2B2B2`, gray6 `#E5E5E5`, gray7 `#FFF`;
red1 `#1A0404`, red2 `#412020`, red3 `#EB6864`; green1 `#121D12`, green2
`#2A4C29`, green3 `#98DC89`; blue1 `#191D52`, blue2 `#5E6DEE`, blue3
`#E2DFE9`; alert `#FF7A30`.

Alt themes (not adopted): tan-light `.t-jffJHW` (gray0 `#F5F1F0` … red3
`#C95D9E`, blue3 `#00075F`), lavender-dark `.t-kEIvFZ` (gray0 `#16171E` …
gray7 `#E7DBF0`, blue3 `#C1C4EA`).

Semantic mappings (both modes): `background`=gray0, `foreground`=gray7,
`link`=gray6, `slate`=gray5, `focus`=blue2, `brandLight`=blue1,
`brandDark`=blue3, `channelPublic1..3`=green1..3,
`channelPrivate1..3`=red1..3, `channelClosed1..3`=gray1/gray3/gray6.

Type: fontSizes 1–9 = `0.78125 / 0.9 / 1 / 1.2 / 1.5 / 1.75 / 2 / 2.5 /
3 rem` at 16px root. Spacing/sizes: `5 / 10 / 15 / 20 / 25 / 35 / 45 / 65 /
80 / 100 / 130 px` + 2px nudge. Radii: `3px`, `50%`, pill. Shadow:
`0 0 20px rgba(0,0,0,.08)`. Fonts: sans = `'areal', 'areal Fallback',
Arial, Helvetica, sans-serif` (areal Fallback = local Arial with
`size-adjust 100.76%, ascent-override 87.13%, descent-override 20.84%`);
serif = Times New Roman.
