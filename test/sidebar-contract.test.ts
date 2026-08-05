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
});
