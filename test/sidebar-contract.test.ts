import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRequest } from '../src/core/messages';

const root = resolve(import.meta.dirname, '..');
const readManifestJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as Record<string, unknown>;

// The shipped Chrome manifest is public/manifest.base.json merged with the
// public/manifest.chrome.json overlay (see scripts/build-manifest.mjs). The
// only array field either file sets is `permissions`, so recreating that
// merge here only needs a plain spread plus an append — this asserts against
// exactly what dist/chrome/manifest.json contains for the Chrome target.
const base = readManifestJson('public/manifest.base.json');
const chromeOverlay = readManifestJson('public/manifest.chrome.json');
const manifest = {
  ...base,
  ...chromeOverlay,
  permissions: [...(base.permissions as string[]), ...(chromeOverlay.permissions as string[])],
} as {
  action?: { default_popup?: string };
  minimum_chrome_version?: string;
  options_page?: string;
  permissions?: string[];
  side_panel?: { default_path?: string };
};
const sidepanelSource = readFileSync(resolve(root, 'src/sidepanel/sidepanel.ts'), 'utf8');
const serviceWorkerSource = readFileSync(resolve(root, 'src/background/service-worker.ts'), 'utf8');
const sidepanelStyles = readFileSync(resolve(root, 'src/sidepanel/sidepanel.css'), 'utf8');
const sidepanelHtml = readFileSync(resolve(root, 'src/sidepanel/sidepanel.html'), 'utf8');
const themeStyles = readFileSync(resolve(root, 'src/styles/arena-theme.css'), 'utf8');

describe('side panel release contract', () => {
  it('uses the Chrome side panel without a popup or browsing-history permission', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.side_panel?.default_path).toBe('sidepanel/sidepanel.html');
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(manifest.options_page).toBeUndefined();
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('keeps tab access and unsafe HTML out of the persistent panel', () => {
    expect(sidepanelSource).not.toContain('chrome.tabs');
    expect(sidepanelSource).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('does not reintroduce the fixed popup width', () => {
    expect(sidepanelStyles).not.toMatch(/(?:min-|max-)?width:\s*360px/);
  });

  it('follows the system theme with Are.na light and dark palettes', () => {
    expect(sidepanelStyles).toContain("@import '../styles/arena-theme.css'");
    expect(sidepanelHtml).toContain('<meta name="color-scheme" content="light dark">');
    expect(themeStyles).toContain('@media (prefers-color-scheme: dark)');
    expect(themeStyles).toContain('--arena-surface: #000');
    expect(themeStyles).toContain('--arena-black: #e5e5e5');
    expect(themeStyles).toContain('--arena-line: #333333');
    expect(themeStyles).toContain('--arena-blue: #5e6dee');
    expect(themeStyles).toContain('--arena-channel-open: #98dc89');
    expect(themeStyles).toContain('--arena-channel-closed: #e5e5e5');
    expect(themeStyles).toContain('--arena-channel-private: #eb6864');
  });

  it('shares the Reader design tokens with the sidebar', () => {
    expect(themeStyles).toContain('--arena-space-1: 4px');
    expect(themeStyles).toContain('--arena-space-4: 16px');
    expect(themeStyles).toContain('--arena-column-gap: 14px');
    expect(themeStyles).toContain('--arena-gutter: 16px');
    expect(themeStyles).toContain('--arena-row-padding: 14px');
    expect(themeStyles).toContain('--arena-text-title: 0.875rem');
    expect(themeStyles).toContain('--arena-text-ui: 0.75rem');
    expect(themeStyles).toContain('--arena-radius: 3px');
    expect(themeStyles).toContain('--arena-control-active: #999');
    expect(themeStyles).toContain('--arena-avatar-size: 14px');
    expect(sidepanelStyles).toContain('--panel-gutter: var(--arena-gutter)');
  });

  it('uses the Reader OAuth card in the sidebar without a separate settings page', () => {
    expect(sidepanelStyles).toContain("@import '../styles/auth-card.css'");
    expect(sidepanelSource).toContain("'Sign in with Are.na ✶✶'");
    expect(sidepanelSource).toContain("'Remember device'");
    expect(sidepanelSource).toContain("send({ kind: 'signIn', remember: checkbox.checked })");
    expect(sidepanelSource).toContain("'Log out'");
    expect(sidepanelSource).toContain("send({ kind: 'signOut' })");
    expect(sidepanelSource).not.toContain('openOptionsPage');
    expect(sidepanelSource).not.toContain("'Settings'");
  });

  it('uses direct block language and bounded two-way sort controls', () => {
    expect(sidepanelSource).toContain("'Connections'");
    expect(sidepanelSource).toContain("'Date'");
    expect(sidepanelSource).toContain("'Sort blocks'");
    expect(sidepanelSource).toContain("'m18 15-6-6-6 6'");
    expect(sidepanelSource).toContain("'m6 9 6 6 6-6'");
    expect(sidepanelStyles).toContain('.sort-chevron');
    expect(sidepanelStyles).not.toContain('.sort-button[aria-pressed="true"]::after');
    expect(sidepanelSource).not.toContain('copy-sort-menu');
    expect(sidepanelSource).not.toContain('siteHeader');
    expect(sidepanelSource).not.toMatch(/copy'\s*:\s*'copies/);
    expect(sidepanelSource).toContain("'channel-title'");
    expect(sidepanelSource).toContain("'Loading connections…'");
    expect(sidepanelSource).toContain("case 'open':");
    expect(sidepanelSource).toContain("case 'public':");
    expect(sidepanelSource).toContain("case 'closed':");
    expect(sidepanelSource).toContain("case 'private':");
    expect(sidepanelSource).toContain("return 'channel-private'");
    expect(themeStyles).toContain('--arena-channel-open: #238020');
    expect(themeStyles).toContain('--arena-channel-closed: #333');
    expect(themeStyles).toContain('--arena-channel-private: #b93d3d');
    expect(sidepanelStyles).toContain('.block-copy.channel-closed');
    expect(sidepanelStyles).toContain('.block-copy.channel-private');
    expect(sidepanelSource).toContain("'metadata-content'");
    expect(sidepanelSource).toContain("'metadata-details'");
    expect(sidepanelSource).not.toContain('renderDetail');
    expect(sidepanelSource).not.toContain('currentView');
    expect(sidepanelSource).toContain("copy.target = '_blank'");
    expect(sidepanelSource).toContain("copy.rel = 'noopener'");
    expect(sidepanelSource).toContain("blockCount === 1 ? 'block' : 'blocks'");
    expect(sidepanelSource).toContain("connectionSummary.count === 1 ? 'connection' : 'connections'");
    expect(sidepanelSource).toContain('`${connectionSummary.count}+ connections`');
    expect(sidepanelSource).toContain("'result-metadata'");
    expect(sidepanelSource).toContain('formatOldestBlockAge(result.blocks)');
  });

  it('tells rate limiting apart from an unreachable Are.na', () => {
    expect(sidepanelSource).toContain("case 'rate_limited':");
    expect(sidepanelSource).toContain("'Are.na is rate limiting.'");
    expect(sidepanelSource).toContain("'Wait a moment and click the toolbar button again.'");
    expect(sidepanelSource).toContain("'Couldn’t reach Are.na.'");
  });
});

describe('background message contract', () => {
  it('accepts every request the side panel sends', () => {
    expect(isRequest({ kind: 'lookup', url: 'https://example.com/a' })).toBe(true);
    expect(isRequest({ kind: 'getConnections', normalizedUrl: 'example.com/a' })).toBe(true);
    expect(isRequest({ kind: 'getAuthState' })).toBe(true);
    expect(isRequest({ kind: 'signIn', remember: false })).toBe(true);
    expect(isRequest({ kind: 'signOut' })).toBe(true);
  });

  it('rejects unknown kinds and malformed payloads', () => {
    expect(isRequest(undefined)).toBe(false);
    expect(isRequest('lookup')).toBe(false);
    expect(isRequest({})).toBe(false);
    expect(isRequest({ kind: 'evaluate', code: 'alert(1)' })).toBe(false);
    expect(isRequest({ kind: 'lookup' })).toBe(false);
    expect(isRequest({ kind: 'lookup', url: 42 })).toBe(false);
    expect(isRequest({ kind: 'getConnections', normalizedUrl: null })).toBe(false);
    expect(isRequest({ kind: 'signIn', remember: 'yes' })).toBe(false);
  });

  it('answers unvalidated messages with an error instead of routing them', () => {
    expect(serviceWorkerSource).toContain('if (!isRequest(message))');
    expect(serviceWorkerSource).not.toContain('message as Request');
  });
});

// The shipped Safari manifest is public/manifest.base.json merged with the
// public/manifest.safari.json overlay, using the same merge shape as the
// Chrome contract above (see scripts/build-manifest.mjs). WS2 owns this page
// as an action popup rather than the Chrome side panel — these assertions
// guard the parts of that swap this workstream is responsible for.
const safariOverlay = readManifestJson('public/manifest.safari.json');
const safariManifest = {
  ...base,
  ...safariOverlay,
  permissions: [
    ...(base.permissions as string[]),
    ...((safariOverlay.permissions as string[] | undefined) ?? []),
  ],
} as {
  action?: { default_popup?: string };
  background?: { service_worker?: string };
  key?: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  side_panel?: { default_path?: string };
};

describe('safari popup contract', () => {
  it('opens as an action popup instead of the Chrome side panel', () => {
    expect(safariManifest.action?.default_popup).toBe('sidepanel/sidepanel.html');
    expect(safariManifest.background?.service_worker).toBe('background/service-worker.js');
    expect(safariManifest.side_panel).toBeUndefined();
    expect(safariManifest.key).toBeUndefined();
    expect(safariManifest.minimum_chrome_version).toBeUndefined();
    expect(safariManifest.permissions).not.toContain('identity');
    expect(safariManifest.permissions).not.toContain('sidePanel');
  });

  it('sizes the popup without reintroducing the old fixed sidebar width', () => {
    expect(sidepanelStyles).toContain('body.popup-mode');
    expect(sidepanelStyles).not.toMatch(/(?:min-|max-)?width:\s*360px/);
  });

  it('hides the OAuth button when the platform adapter does not support it, falling back to token sign-in', () => {
    expect(sidepanelSource).toContain('platform.supportsOAuth');
    expect(sidepanelSource).toContain('signInWithToken');
    expect(sidepanelSource).not.toContain('chrome.tabs');
  });
});
