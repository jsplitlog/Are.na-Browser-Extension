import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const sourceManifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8')) as Record<string, unknown>;
const distributionManifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8')) as unknown;

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
    expect(readme).toContain('Authorization Code + PKCE');
    expect(readme).toContain('https://www.are.na/developers/oauth/authorized');
    expect(readme).not.toContain('personal access token');
    expect(readme).not.toContain('Use token');
  });

  it('ships a prebuilt distribution with the current manifest', () => {
    expect(distributionManifest).toEqual(sourceManifest);
  });

  it('pins the OAuth callback to the registered development extension ID', () => {
    expect(typeof sourceManifest.key).toBe('string');
    const digest = createHash('sha256').update(Buffer.from(sourceManifest.key as string, 'base64')).digest('hex').slice(0, 32);
    const extensionId = [...digest].map((digit) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(digit, 16))).join('');

    expect(extensionId).toBe('poolkoglmiobmahcbamkbhljhgeooajm');
    expect(readme).toContain(`https://${extensionId}.chromiumapp.org/oauth2`);
  });
});
