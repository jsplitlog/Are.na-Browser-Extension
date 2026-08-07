#!/usr/bin/env node
// Builds each requested target and zips its dist/<target>/ output into a
// store-ready dist/arena-connections-<target>-<version>.zip. See
// docs/cross-browser-plan.md's WS4 section for the acceptance criteria this
// implements.
//
// Dependency-free: the build step shells out to `npm run build:<target>`
// (already the source of truth for how a target is built — see package.json
// and vite.config.ts) and archiving shells out to the system `zip` binary via
// node:child_process. `zip` ships with macOS and most Linux distros; if it's
// missing this fails loudly up front instead of silently producing nothing.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './build-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const requestedTargets = process.argv.slice(2);
for (const target of requestedTargets) {
  if (!TARGETS.includes(target)) {
    console.error(`Unknown target "${target}". Expected one of: ${TARGETS.join(', ')}.`);
    process.exit(1);
  }
}
const targets = requestedTargets.length > 0 ? requestedTargets : TARGETS;

const assertZipAvailable = () => {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch {
    console.error(
      'The "zip" command is not available on this system. It ships with macOS and most Linux ' +
        'distros by default (e.g. `apt-get install zip` on Debian/Ubuntu if it is missing); ' +
        'install it and re-run `npm run package`.',
    );
    process.exit(1);
  }
};

// Chrome's `key` manifest field pins a stable extension ID for local unpacked
// development reloads. The Chrome Web Store assigns its own ID on publish and
// rejects/ignores a `key` in an uploaded package, so store-ready zips must not
// contain it. dist/chrome/manifest.json on disk (what "Load unpacked" reads)
// is left untouched — the field is stripped only in a staging copy used for
// the zip.
const stripChromeKey = (manifest) => {
  const { key, ...rest } = manifest;
  return rest;
};

const packageTarget = (target) => {
  const distDir = resolve(root, 'dist', target);

  console.log(`\nBuilding ${target}...`);
  try {
    execFileSync('npm', ['run', `build:${target}`], { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`\n\`npm run build:${target}\` failed — fix the build before packaging ${target}.`);
    process.exit(1);
  }
  if (!existsSync(resolve(distDir, 'manifest.json'))) {
    console.error(
      `dist/${target}/manifest.json is missing after \`npm run build:${target}\` — the build did ` +
        'not produce the expected output.',
    );
    process.exit(1);
  }

  const staging = mkdtempSync(resolve(tmpdir(), `arena-connections-${target}-`));
  try {
    cpSync(distDir, staging, { recursive: true });
    if (target === 'chrome') {
      const manifestPath = resolve(staging, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      writeFileSync(manifestPath, `${JSON.stringify(stripChromeKey(manifest), null, 2)}\n`);
    }

    const zipName = `arena-connections-${target}-${version}.zip`;
    const zipPath = resolve(root, 'dist', zipName);
    rmSync(zipPath, { force: true });
    // -X: drop extra file attributes/timestamps for a more reproducible archive; -r: recurse.
    execFileSync('zip', ['-r', '-X', zipPath, '.'], { cwd: staging, stdio: 'inherit' });
    console.log(`Wrote dist/${zipName}`);
    return zipPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

assertZipAvailable();
mkdirSync(resolve(root, 'dist'), { recursive: true });
const zips = targets.map(packageTarget);
console.log(`\nPackaged ${zips.length} target${zips.length === 1 ? '' : 's'}:`);
for (const zip of zips) console.log(`  ${zip}`);
