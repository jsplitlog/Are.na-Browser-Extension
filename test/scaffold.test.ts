import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const readManifestJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as Record<string, unknown>;

// See test/sidebar-contract.test.ts for why this recreates the base + chrome
// overlay merge (scripts/build-manifest.mjs) instead of reading a single file:
// public/manifest.json no longer exists, split into per-target overlays.
const base = readManifestJson('public/manifest.base.json');
const chromeOverlay = readManifestJson('public/manifest.chrome.json');
const sourceManifest: Record<string, unknown> = {
  ...base,
  ...chromeOverlay,
  permissions: [...(base.permissions as string[]), ...(chromeOverlay.permissions as string[])],
};
// dist/chrome/manifest.json is now a build output (`npm run build:chrome`),
// not a committed prebuilt distribution — run the build before `npm test`.
const distributionManifest = readManifestJson('dist/chrome/manifest.json');

describe('distribution scaffold', () => {
  it('documents unpacked installation and the OAuth connection path', () => {
    expect(readme).toContain('Download ZIP');
    expect(readme).toContain('npm ci');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('chrome://extensions');
    expect(readme).toContain('Load unpacked');
    expect(readme).toContain('dist');
    expect(readme).toContain('Build from source');
    expect(readme).toContain('Sign in with Are.na ✶✶');
    expect(readme).toContain('https://www.are.na/developers/oauth/authorized');
    expect(readme).not.toContain('OAuth configuration');
    expect(readme).not.toContain('chromiumapp.org');
    expect(readme).not.toContain('personal access token');
    expect(readme).not.toContain('Use token');
  });

  it('builds a Chrome distribution with the current manifest', () => {
    expect(distributionManifest).toEqual(sourceManifest);
  });

  it('pins the registered development extension ID', () => {
    expect(typeof sourceManifest.key).toBe('string');
    const digest = createHash('sha256').update(Buffer.from(sourceManifest.key as string, 'base64')).digest('hex').slice(0, 32);
    const extensionId = [...digest].map((digit) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(digit, 16))).join('');

    expect(extensionId).toBe('poolkoglmiobmahcbamkbhljhgeooajm');
  });
});
