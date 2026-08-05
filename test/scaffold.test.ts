import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

describe('distribution scaffold', () => {
  it('documents the unpacked install and PAT setup paths', () => {
    expect(readme).toContain('npm ci');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('chrome://extensions');
    expect(readme).toContain('Load unpacked');
    expect(readme).toContain('dist');
    expect(readme).toContain('https://www.are.na/developers/personal-access-tokens');
    expect(readme).toContain('Sign in with token');
  });
});
