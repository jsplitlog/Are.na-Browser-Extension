import { execFileSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const TARGETS = ['chrome', 'firefox', 'safari'] as const;
type Target = (typeof TARGETS)[number];

const rawTarget = process.env.TARGET ?? 'chrome';
if (!(TARGETS as readonly string[]).includes(rawTarget)) {
  throw new Error(`Unknown TARGET "${rawTarget}". Expected one of: ${TARGETS.join(', ')}.`);
}
const target = rawTarget as Target;

const outDir = resolve(import.meta.dirname, 'dist', target);

// public/ holds icons plus the manifest overlay sources (manifest.base.json,
// manifest.<target>.json, ...). Vite's built-in publicDir copy would dump every
// manifest*.json straight into the output, so it is disabled (publicDir: false)
// below; this plugin copies only icons/, then shells out to
// scripts/build-manifest.mjs to write the single merged manifest.json — the
// same merge `npm run build:<target>` runs explicitly afterward. Shelling out
// (rather than importing the .mjs) keeps `tsc --noEmit` from having to resolve
// a plain JS module with no declaration file.
const copyStaticFiles: Plugin = {
  name: 'copy-static-files',
  writeBundle() {
    cpSync(resolve(import.meta.dirname, 'public/icons'), resolve(outDir, 'icons'), { recursive: true });
    execFileSync('node', [resolve(import.meta.dirname, 'scripts/build-manifest.mjs'), target], { stdio: 'inherit' });
  },
};

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: false,
  plugins: [copyStaticFiles],
  define: {
    __TARGET__: JSON.stringify(target),
  },
  build: {
    outDir,
    emptyOutDir: true,
    // Chrome extension pages run in a separate execution world. Vite's generated
    // modulepreload links are therefore rejected as cross-world resources.
    // Native module imports still load the same code-split chunks on demand.
    modulePreload: false,
    rollupOptions: {
      input: {
        'sidepanel/sidepanel': resolve(import.meta.dirname, 'src/sidepanel/sidepanel.html'),
        // Firefox loads this same file as a background.scripts event page rather
        // than a service worker (see manifest.firefox.json); keep this source
        // worker-safe (no `window`, no DOM) so one output serves both shapes.
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker'
            ? 'background/service-worker.js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
