import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

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

// WS0 retired the committed, prebuilt dist/ folder in favor of per-target build
// output (dist/<target>/, produced by `npm run build:<target>`), which left this
// test depending on a stale/missing artifact: a clean clone had no dist/chrome/
// manifest.json until someone ran a build, so `npm test` failed out of the box.
// Fixed by invoking the real manifest-merge step (scripts/build-manifest.mjs's
// writeMergedManifest) ourselves, into a throwaway temp dir, rather than either
// (a) trusting a possibly-stale dist/chrome/manifest.json left on disk, or
// (b) running a full `npm run build:chrome` (tsc + vite + rollup) just to check a
// JSON merge, which would make every `npm test` pay for a full asset build.
// scripts/build-manifest.mjs is loaded via a dynamic, non-literal import() (as
// vite.config.ts also does, see its comment) so `tsc --noEmit` never has to
// resolve a plain .mjs module with no declaration file.
const buildManifestModule = resolve(root, 'scripts/build-manifest.mjs');
const { writeMergedManifest } = (await import(pathToFileURL(buildManifestModule).href)) as {
  writeMergedManifest: (target: string, outDir: string) => Record<string, unknown>;
};
const tempOutDir = mkdtempSync(resolve(tmpdir(), 'arena-connections-manifest-'));
writeMergedManifest('chrome', tempOutDir);
const distributionManifest = readManifestJson(resolve(tempOutDir, 'manifest.json'));

afterAll(() => {
  rmSync(tempOutDir, { recursive: true, force: true });
});

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
