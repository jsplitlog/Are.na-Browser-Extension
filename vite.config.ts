import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    // Chrome extension pages run in a separate execution world. Vite's generated
    // modulepreload links are therefore rejected as cross-world resources.
    // Native module imports still load the same code-split chunks on demand.
    modulePreload: false,
    rollupOptions: {
      input: {
        'popup/popup': resolve(import.meta.dirname, 'src/popup/popup.html'),
        'options/options': resolve(import.meta.dirname, 'src/options/options.html'),
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
