#!/usr/bin/env node
// Stub so `npm run package` exists and exits cleanly. WS4 owns the real
// implementation: build all targets, then zip each dist/<target>/ into
// dist/arena-connections-<target>-<version>.zip (excluding the Chrome `key`
// from store-bound builds), per docs/cross-browser-plan.md WS4.
console.log('npm run package is not implemented yet — see WS4 in docs/cross-browser-plan.md.');
process.exit(0);
