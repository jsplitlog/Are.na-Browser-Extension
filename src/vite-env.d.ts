/// <reference types="vite/client" />

/** Build-time target, injected via Vite `define` (see vite.config.ts). */
declare const __TARGET__: 'chrome' | 'firefox' | 'safari';
