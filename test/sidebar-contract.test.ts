import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8')) as {
  action?: { default_popup?: string };
  minimum_chrome_version?: string;
  permissions?: string[];
  side_panel?: { default_path?: string };
};
const sidepanelSource = readFileSync(resolve(root, 'src/sidepanel/sidepanel.ts'), 'utf8');
const sidepanelStyles = readFileSync(resolve(root, 'src/sidepanel/sidepanel.css'), 'utf8');
const sidepanelHtml = readFileSync(resolve(root, 'src/sidepanel/sidepanel.html'), 'utf8');
const optionsStyles = readFileSync(resolve(root, 'src/options/options.css'), 'utf8');
const optionsHtml = readFileSync(resolve(root, 'src/options/options.html'), 'utf8');
const themeStyles = readFileSync(resolve(root, 'src/styles/arena-theme.css'), 'utf8');

describe('side panel release contract', () => {
  it('uses the Chrome side panel without a popup or browsing-history permission', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.side_panel?.default_path).toBe('sidepanel/sidepanel.html');
    expect(manifest.action?.default_popup).toBeUndefined();
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
    expect(optionsStyles).toContain("@import '../styles/arena-theme.css'");
    expect(sidepanelHtml).toContain('<meta name="color-scheme" content="light dark">');
    expect(optionsHtml).toContain('<meta name="color-scheme" content="light dark">');
    expect(themeStyles).toContain('@media (prefers-color-scheme: dark)');
    expect(themeStyles).toContain('--arena-surface: #000');
    expect(themeStyles).toContain('--arena-black: #d3d3d3');
    expect(themeStyles).toContain('--arena-line: #2f2f2f');
    expect(themeStyles).toContain('--arena-blue: #17b0e2');
    expect(themeStyles).toContain('--arena-channel-open: #2ba425');
  });

  it('uses direct block language and bounded two-way sort controls', () => {
    expect(sidepanelSource).toContain("'Connections'");
    expect(sidepanelSource).toContain("'Date'");
    expect(sidepanelSource).toContain("'Sort blocks'");
    expect(sidepanelSource).not.toContain('copy-sort-menu');
    expect(sidepanelSource).not.toContain('siteHeader');
    expect(sidepanelSource).not.toMatch(/copy'\s*:\s*'copies/);
    expect(sidepanelSource).toContain("'channel-title'");
    expect(sidepanelSource).toContain("'Loading connections…'");
    expect(sidepanelSource).toContain("channel?.status === 'open'");
    expect(sidepanelSource).toContain("channel?.status === 'public'");
    expect(themeStyles).toContain('--arena-channel-open: #17ac10');
    expect(sidepanelSource).toContain("'metadata-content'");
    expect(sidepanelSource).toContain("'metadata-details'");
    expect(sidepanelSource).not.toContain('renderDetail');
    expect(sidepanelSource).not.toContain('currentView');
    expect(sidepanelSource).toContain("copy.target = '_blank'");
    expect(sidepanelSource).toContain("copy.rel = 'noopener'");
    expect(sidepanelSource).toContain("blockCount === 1 ? 'block' : 'blocks'");
    expect(sidepanelSource).toContain("connectionCount === 1 ? 'connection' : 'connections'");
    expect(sidepanelSource).toContain("'result-metadata'");
    expect(sidepanelSource).toContain('formatOldestBlockAge(result.blocks)');
  });
});
