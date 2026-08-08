#!/usr/bin/env node
// Deep-merges public/manifest.base.json with a per-target overlay
// (public/manifest.<target>.json) and writes dist/<target>/manifest.json.
// Kept dependency-free and reused by vite.config.ts (via child_process, so
// TypeScript never has to resolve this plain .mjs module) and by the
// manifest-contract tests, which re-derive the same merge inline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = ['chrome', 'firefox', 'safari'];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Merges `overlay` onto `base`:
 * - Plain objects merge key-by-key, recursively.
 * - `permissions` arrays append (base entries first) and de-duplicate.
 * - Every other array, and every other value type, is replaced by the overlay.
 */
export const mergeManifest = (base, overlay) => {
  const result = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    if (key === 'permissions' && Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      result[key] = [...new Set([...baseValue, ...overlayValue])];
    } else if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = mergeManifest(baseValue, overlayValue);
    } else {
      result[key] = overlayValue;
    }
  }
  return result;
};

const readManifestJson = (relativePath) => JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));

export const buildManifestFor = (target) => {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown manifest target "${target}". Expected one of: ${TARGETS.join(', ')}.`);
  }
  const base = readManifestJson('public/manifest.base.json');
  const overlay = readManifestJson(`public/manifest.${target}.json`);
  // package.json is the single source of truth for the version: hand-bumping
  // it in two files desyncs the zip filename (scripts/package.mjs reads
  // package.json) from the manifest the stores actually read.
  const { version } = readManifestJson('package.json');
  return { ...mergeManifest(base, overlay), version };
};

export const writeMergedManifest = (target, outDir) => {
  const merged = buildManifestFor(target);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
};

const isMain = () => {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
  return invoked === fileURLToPath(import.meta.url);
};

if (isMain()) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/build-manifest.mjs <chrome|firefox|safari>');
    process.exit(1);
  }
  const outDir = resolve(root, 'dist', target);
  writeMergedManifest(target, outDir);
  console.log(`Wrote dist/${target}/manifest.json`);
}
