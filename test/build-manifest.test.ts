import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readManifestJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as Record<string, unknown>;

// Loaded via a dynamic, non-literal import() rather than a static `import` so
// `tsc --noEmit` never has to resolve this plain .mjs module (no declaration
// file) — the same trick vite.config.ts and test/scaffold.test.ts use, and for
// the same reason (see vite.config.ts's copy-static-files plugin comment).
const buildManifestModule = resolve(root, 'scripts/build-manifest.mjs');
const { mergeManifest, buildManifestFor, TARGETS } = (await import(pathToFileURL(buildManifestModule).href)) as {
  mergeManifest: (base: Record<string, unknown>, overlay: Record<string, unknown>) => Record<string, unknown>;
  buildManifestFor: (target: string) => Record<string, unknown>;
  TARGETS: readonly string[];
};

describe('mergeManifest (scripts/build-manifest.mjs)', () => {
  it('deep-merges nested plain objects, overlay winning on conflicting leaves', () => {
    const base = {
      name: 'Base',
      action: { default_icon: { 16: 'base-16.png', 32: 'base-32.png' } },
      background: { service_worker: 'sw.js' },
    };
    const overlay = {
      action: { default_icon: { 16: 'overlay-16.png' } },
      background: { type: 'module' },
    };
    expect(mergeManifest(base, overlay)).toEqual({
      name: 'Base',
      action: { default_icon: { 16: 'overlay-16.png', 32: 'base-32.png' } },
      background: { service_worker: 'sw.js', type: 'module' },
    });
  });

  it('appends and de-duplicates the permissions array, keeping base entries first', () => {
    const merged = mergeManifest(
      { permissions: ['activeTab', 'storage'] },
      { permissions: ['storage', 'identity'] },
    );
    expect(merged.permissions).toEqual(['activeTab', 'storage', 'identity']);
  });

  it('replaces (does not merge or append) every other array field', () => {
    const merged = mergeManifest(
      { host_permissions: ['https://a.example/*'] },
      { host_permissions: ['https://b.example/*'] },
    );
    expect(merged.host_permissions).toEqual(['https://b.example/*']);
  });

  it('adds overlay-only keys and leaves base-only keys untouched', () => {
    const merged = mergeManifest({ name: 'Base', version: '1.0' }, { key: 'overlay-only-key' });
    expect(merged).toEqual({ name: 'Base', version: '1.0', key: 'overlay-only-key' });
  });

  it('replaces a base scalar with an overlay scalar of a different shape (no partial merge of mismatched types)', () => {
    const merged = mergeManifest({ background: 'not-an-object' }, { background: { service_worker: 'sw.js' } });
    expect(merged.background).toEqual({ service_worker: 'sw.js' });
  });
});

describe('buildManifestFor (scripts/build-manifest.mjs)', () => {
  it('lists exactly chrome, firefox, safari as targets', () => {
    expect([...TARGETS].sort()).toEqual(['chrome', 'firefox', 'safari']);
  });

  it('rejects an unknown target', () => {
    expect(() => buildManifestFor('android')).toThrow(/Unknown manifest target/);
  });

  it('keeps Chrome-only fields (key, minimum_chrome_version) out of the Firefox and Safari manifests', () => {
    // These two fields are meaningless (and in the case of `key`, actively wrong —
    // the Chrome Web Store rejects/ignores it) outside a Chrome build. Only
    // public/manifest.chrome.json should ever set them.
    const firefox = buildManifestFor('firefox');
    const safari = buildManifestFor('safari');
    expect(firefox.key).toBeUndefined();
    expect(firefox.minimum_chrome_version).toBeUndefined();
    expect(safari.key).toBeUndefined();
    expect(safari.minimum_chrome_version).toBeUndefined();
  });

  it('sets Chrome-only fields on the Chrome manifest', () => {
    const chromeManifest = buildManifestFor('chrome');
    expect(typeof chromeManifest.key).toBe('string');
    expect(chromeManifest.minimum_chrome_version).toBe('116');
  });

  it('deep-merges nested objects from the real source files rather than replacing them wholesale', () => {
    // public/manifest.base.json's `action.default_icon` block and each overlay's own
    // `action` keys (e.g. safari's `action.default_popup`) must both survive — a
    // shallow `{ ...base, ...overlay }` would drop default_icon entirely for any
    // overlay that also sets `action`. This exercises the real files, not a fixture.
    const base = readManifestJson('public/manifest.base.json');
    const baseIcon = (base.action as { default_icon: unknown }).default_icon;
    for (const target of TARGETS) {
      const overlay = readManifestJson(`public/manifest.${target}.json`) as { action?: Record<string, unknown> };
      const merged = buildManifestFor(target) as { action: { default_icon: unknown } };
      expect(merged.action.default_icon).toEqual(baseIcon);
      if (overlay.action) {
        for (const [key, value] of Object.entries(overlay.action)) {
          expect((merged.action as Record<string, unknown>)[key]).toEqual(value);
        }
      }
    }
  });

  it('permissions on every merged manifest are exactly the base set plus that overlay\'s own set, deduped', () => {
    const base = readManifestJson('public/manifest.base.json');
    const basePermissions = base.permissions as string[];
    for (const target of TARGETS) {
      const overlay = readManifestJson(`public/manifest.${target}.json`) as { permissions?: string[] };
      const overlayPermissions = overlay.permissions ?? [];
      const merged = buildManifestFor(target).permissions as string[];
      expect(new Set(merged)).toEqual(new Set([...basePermissions, ...overlayPermissions]));
      expect(merged.length).toBe(new Set(merged).size); // no duplicates
    }
  });

  it('every target keeps the shared permissions from the base manifest', () => {
    const base = readManifestJson('public/manifest.base.json');
    for (const target of TARGETS) {
      const merged = buildManifestFor(target);
      for (const permission of base.permissions as string[]) {
        expect(merged.permissions as string[]).toContain(permission);
      }
    }
  });
});
