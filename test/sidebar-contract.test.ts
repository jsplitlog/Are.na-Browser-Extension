import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8')) as {
  action?: { default_popup?: string };
  minimum_chrome_version?: string;
  options_page?: string;
  permissions?: string[];
  side_panel?: { default_path?: string };
};
const sidepanelSource = readFileSync(resolve(root, 'src/sidepanel/sidepanel.ts'), 'utf8');
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
    expect(themeStyles).toContain('--arena-black: #d3d3d3');
    expect(themeStyles).toContain('--arena-line: #2f2f2f');
    expect(themeStyles).toContain('--arena-blue: #17b0e2');
    expect(themeStyles).toContain('--arena-channel-open: #2ba425');
    expect(themeStyles).toContain('--arena-channel-closed: #d3d3d3');
    expect(themeStyles).toContain('--arena-channel-private: #e24937');
  });

  it('shares the Reader design tokens with the sidebar', () => {
    expect(themeStyles).toContain('--arena-space-1: 4px');
    expect(themeStyles).toContain('--arena-space-4: 16px');
    expect(themeStyles).toContain('--arena-column-gap: 14px');
    expect(themeStyles).toContain('--arena-gutter: 16px');
    expect(themeStyles).toContain('--arena-row-padding: 14px');
    expect(themeStyles).toContain('--arena-text-title: 0.875rem');
    expect(themeStyles).toContain('--arena-text-ui: 0.75rem');
    expect(themeStyles).toContain('--arena-radius: 0.25rem');
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
    expect(themeStyles).toContain('--arena-channel-open: #17ac10');
    expect(themeStyles).toContain('--arena-channel-closed: #4b3d67');
    expect(themeStyles).toContain('--arena-channel-private: #b60202');
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
});
