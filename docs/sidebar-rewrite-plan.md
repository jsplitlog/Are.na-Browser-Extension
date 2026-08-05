# Sidebar rewrite plan

## Goal

Replace the fixed-size action popup with a persistent Chrome side panel that can
comfortably present long result sets and a focused block-detail view. The panel
should feel closer to Are.na's block viewer while preserving the extension's
manual, privacy-cheap lookup model.

## Product model

- Clicking the toolbar action opens the side panel and checks only that tab.
- The side panel remains available as a global companion, but it does not follow
  tab changes or send browsing activity automatically.
- A new toolbar click explicitly hands the active page to the open panel.
- The master view lists discrete matching block copies and preserves sort and
  scroll state while a detail view is open.
- The detail view keeps the block in context and links to its canonical Are.na
  page.

## Metadata rules

- Use the block creation date without the word “Created.”
- Separate metadata with layout spacing, never bullet characters.
- Describe totals as “connection” or “connections,” never “channel(s).”
- Display only the originating channel: the oldest block connection, requested
  with `sort=created_at_asc&per=1`.
- Preserve `meta.total_count` as the complete connection total even though only
  one channel is rendered.

## Chrome architecture

- Add a global `side_panel.default_path` and the `sidePanel` permission.
- Require Chrome 116 because opening the panel is part of an explicit action
  click.
- Remove `action.default_popup`; the action listener receives the temporary
  `activeTab` grant, records `{ url, requestedAt }` in session storage, and opens
  the panel.
- The panel reads and observes that session value. It never imports or calls
  `chrome.tabs`.
- Do not request the `tabs` permission or add navigation listeners. Ambient tab
  following remains a separately consented future feature.

## UI architecture

- Use a fluid-width extension page with no popup width assumptions.
- Enter directly into compact page context; let the document own vertical
  scrolling without a redundant extension-brand header.
- Use two bounded, mutually exclusive sort controls: Connections and Date.
  Clicking the active control reverses its order; choosing the other control
  activates it and restores its descending default.
- Treat search and connection data as untrusted and render it only through DOM
  creation and `textContent`.
- Suppress stale async responses when a newer toolbar request arrives.
- Support pointer and keyboard navigation throughout the sort menu and
  master/detail transition.

## Visual language

- Follow Are.na's frontend tokens from `aredotna/ervell` at
  `2fcb6d2b85b4d6fbe6cd1a36641aac2d91955c47`: Arial, white surfaces, compact
  spacing, `#333` headings, `#585858` body text, `#999` metadata, `#eee`
  dividers, and `#00bbf7` focus rings.
- Keep controls flat, native-looking, and bounded by one-pixel gray borders.
  Avoid translucent surfaces, backdrop blur, elevated shadows, and decorative
  motion.
- Use clipped state language modeled on Are.na's own empty states: direct labels
  such as “Nothing found.” with supporting copy only when it helps the user act.
- Keep hierarchy typographic and structural. Use compact rules and spacing
  instead of cards or ornamental containers.

## Commit sequence

1. **Load originating block connections** — tighten the API contract and tests.
2. **Open manual lookups in side panel** — add manifest, build, action, and
   session-handoff plumbing.
3. **Build responsive block viewer** — replace the popup surface with the
   master/detail side panel and apply the metadata rules.
4. **Polish and verify sidebar migration** — integrate, document, test, build,
   and validate extension invariants.
5. **Match sidebar to Are.na UI** — adopt Are.na's visual tokens and clipped UI
   language.
6. **Align the native panel hierarchy** — remove the redundant product header
   and replace the sort menu with direct reversible controls.

## Acceptance criteria

- The toolbar opens the extension in Chrome's side panel.
- A 40-block result scrolls naturally without a popup-height ceiling.
- Selecting a block opens an in-panel detail view; Back restores the master view
  and scroll position.
- Each block shows creator, plain date, total connections, and at most one
  originating channel.
- A new explicit toolbar click refreshes the open panel for that page.
- Signed-out, skipped, miss, Premium, network, and stale-request states remain
  distinct.
- No `tabs` permission, ambient navigation listener, unsafe HTML rendering, or
  fixed 360 px side-panel width is introduced.
- Unit tests, TypeScript, production build, service-worker registration, and
  manifest target checks pass.
