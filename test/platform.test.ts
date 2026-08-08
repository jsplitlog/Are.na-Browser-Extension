import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, PlatformTab } from '../src/platform/index';
import { chromePlatform } from '../src/platform/chrome';
import { firefoxPlatform } from '../src/platform/firefox';
import { safariPlatform } from '../src/platform/safari';
import { platform } from '../src/platform/index';

const root = resolve(import.meta.dirname, '..');
const tab: PlatformTab = { windowId: 7, url: 'https://example.com' };

const assertAdapterShape = (adapter: PlatformAdapter): void => {
  expect(typeof adapter.supportsOAuth).toBe('boolean');
  expect(typeof adapter.offersTokenSignIn).toBe('boolean');
  expect(typeof adapter.openPanel).toBe('function');
  expect(typeof adapter.getRedirectURL).toBe('function');
  expect(typeof adapter.launchAuthFlow).toBe('function');
};

describe('PlatformAdapter shape', () => {
  // Each target's adapter, whatever it does internally, must satisfy the same
  // interface src/background/service-worker.ts and core/auth.ts code against.
  it.each([
    ['chrome', chromePlatform],
    ['firefox', firefoxPlatform],
    ['safari', safariPlatform],
  ] as const)('%s adapter exposes the full PlatformAdapter surface', (_name, adapter) => {
    assertAdapterShape(adapter);
  });
});

describe('__TARGET__ selection (src/platform/index.ts)', () => {
  it('resolves to the chrome adapter under the default (unset TARGET) build', () => {
    // vite.config.ts defaults TARGET to 'chrome' when the env var is unset, which is
    // the case for a plain `npm test` / `vitest run`. This is a real runtime check of
    // that default, not just a source read.
    expect(platform).toBe(chromePlatform);
  });

  it('selects via a literal ternary on __TARGET__, not an object map keyed by target', () => {
    // Rollup can only dead-branch-eliminate the two unchosen adapters (and their
    // unsupported browser-API calls, e.g. chrome.sidePanel in the Firefox bundle) out
    // of each build if the selection is a literal `__TARGET__ === '<x>' ? ... : ...`
    // chain — an object map (`{ chrome: chromePlatform, ... }[__TARGET__]`) keeps all
    // three referenced and defeats tree-shaking. That's a bundle-level property that
    // requires an actual per-target build to observe directly (see WS0's handoff notes
    // in docs/cross-browser-plan.md, re-verified manually for WS4 via `npm run build`
    // + grep on dist/<target>/background/service-worker.js); this is the cheap
    // source-level guard against a refactor that would silently reintroduce the map
    // form and break that invariant.
    const source = readFileSync(resolve(root, 'src/platform/index.ts'), 'utf8');
    expect(source).toMatch(/__TARGET__\s*===\s*'chrome'\s*\?\s*chromePlatform/);
    expect(source).toMatch(/__TARGET__\s*===\s*'firefox'\s*\?\s*firefoxPlatform/);
    expect(source).not.toMatch(/[[{]\s*chrome:\s*chromePlatform/);
  });
});

describe('chrome adapter', () => {
  const sidePanelOpen = vi.fn(async () => undefined);
  const getRedirectURL = vi.fn((path?: string) => `https://chrome-ext-id.chromiumapp.org/${path ?? ''}`);
  const launchWebAuthFlow = vi.fn(async () => 'https://chrome-ext-id.chromiumapp.org/oauth2?code=abc');

  beforeEach(() => {
    sidePanelOpen.mockClear();
    getRedirectURL.mockClear();
    launchWebAuthFlow.mockClear();
    vi.stubGlobal('chrome', {
      sidePanel: { open: sidePanelOpen },
      identity: { getRedirectURL, launchWebAuthFlow },
    });
  });

  it('opens the side panel for the clicked window', async () => {
    await chromePlatform.openPanel(tab);
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 });
  });

  it('is a no-op when the tab has no windowId', async () => {
    // chrome.tabs.Tab types windowId as always-present, but the action.onClicked
    // handler and this adapter both defensively check for undefined at runtime
    // (background/service-worker.ts does the same) — exercise that branch.
    const windowlessTab = { windowId: undefined, url: tab.url } as unknown as PlatformTab;
    await chromePlatform.openPanel(windowlessTab);
    expect(sidePanelOpen).not.toHaveBeenCalled();
  });

  it('calls chrome.sidePanel.open synchronously — no await stands between the gesture and the call', () => {
    // background/service-worker.ts calls `platform.openPanel(tab)` directly out of
    // action.onClicked with no leading await, relying on the call landing inside the
    // click's user-activation window. Proving that means checking the mock was
    // invoked before this test itself ever awaits anything — i.e. still in the same
    // microtask as the call expression below.
    void chromePlatform.openPanel(tab);
    expect(sidePanelOpen).toHaveBeenCalledTimes(1);
  });

  it('delegates getRedirectURL to chrome.identity.getRedirectURL', () => {
    expect(chromePlatform.getRedirectURL('oauth2')).toBe('https://chrome-ext-id.chromiumapp.org/oauth2');
    expect(getRedirectURL).toHaveBeenCalledWith('oauth2');
  });

  it('delegates launchAuthFlow to an interactive chrome.identity.launchWebAuthFlow', async () => {
    await expect(chromePlatform.launchAuthFlow('https://www.are.na/oauth/authorize?x=1'))
      .resolves.toBe('https://chrome-ext-id.chromiumapp.org/oauth2?code=abc');
    expect(launchWebAuthFlow).toHaveBeenCalledWith({ url: 'https://www.are.na/oauth/authorize?x=1', interactive: true });
  });

  it('supports OAuth', () => {
    expect(chromePlatform.supportsOAuth).toBe(true);
  });
});

// Firefox has no chrome.sidePanel; the plan (docs/cross-browser-plan.md, WS1) specifies
// browser.sidebarAction.open() as the replacement, reachable synchronously from the same
// action.onClicked gesture, with identity handled the same way as Chrome. These tests
// assert that contract, not incidental details of the current stub — WS1 is landing on
// src/platform/firefox.ts concurrently with this work; a failure here after that lands
// unchanged is a real regression, not something to weaken.
describe('firefox adapter', () => {
  const sidebarOpen = vi.fn(async () => undefined);
  const getRedirectURL = vi.fn((path?: string) => `https://firefox-ext.extensions.allizom.org/${path ?? ''}`);
  const launchWebAuthFlow = vi.fn(async () => 'https://firefox-ext.extensions.allizom.org/oauth2?code=abc');

  beforeEach(() => {
    sidebarOpen.mockClear();
    getRedirectURL.mockClear();
    launchWebAuthFlow.mockClear();
    vi.stubGlobal('chrome', {
      sidebarAction: { open: sidebarOpen },
      identity: { getRedirectURL, launchWebAuthFlow },
    });
  });

  it('opens the sidebar action panel', async () => {
    await firefoxPlatform.openPanel(tab);
    expect(sidebarOpen).toHaveBeenCalledTimes(1);
  });

  it('calls sidebarAction.open synchronously — no await stands between the gesture and the call', () => {
    void firefoxPlatform.openPanel(tab);
    expect(sidebarOpen).toHaveBeenCalledTimes(1);
  });

  it('delegates identity calls the same way as chrome', async () => {
    expect(firefoxPlatform.getRedirectURL('oauth2')).toBe('https://firefox-ext.extensions.allizom.org/oauth2');
    await expect(firefoxPlatform.launchAuthFlow('https://www.are.na/oauth/authorize?x=1')).resolves.toContain('code=abc');
    expect(launchWebAuthFlow).toHaveBeenCalledWith({ url: 'https://www.are.na/oauth/authorize?x=1', interactive: true });
  });

  it('supports OAuth', () => {
    expect(firefoxPlatform.supportsOAuth).toBe(true);
  });
});

// Safari has neither chrome.sidePanel nor chrome.identity. Whatever WS2 lands on
// (popup + a tab-based OAuth flow, or token-only sign-in behind supportsOAuth: false),
// the one invariant that must hold on every iteration is that this adapter never
// touches those two Chrome-only namespaces — accessing either is a bug on Safari,
// where they don't exist. That's what these tests enforce, rather than pinning today's
// "not implemented yet" stub bodies.
describe('safari adapter', () => {
  const chromeStub = {
    get sidePanel(): never {
      throw new Error('safari adapter touched chrome.sidePanel, which does not exist on Safari');
    },
    get identity(): never {
      throw new Error('safari adapter touched chrome.identity, which does not exist on Safari');
    },
  };

  beforeEach(() => {
    vi.stubGlobal('chrome', chromeStub);
  });

  it('never touches chrome.sidePanel when opening the panel (Safari opens its own action popup)', async () => {
    await expect(safariPlatform.openPanel(tab)).resolves.toBeUndefined();
  });

  it('never touches chrome.identity from getRedirectURL or launchAuthFlow', async () => {
    // The current WS2 stub throws its own "not implemented" error for both; a real
    // implementation might instead resolve a tab-based-flow URL. Either way is fine —
    // only reaching into chrome.identity is not.
    await Promise.allSettled([
      Promise.resolve().then(() => safariPlatform.getRedirectURL()),
      Promise.resolve().then(() => safariPlatform.launchAuthFlow('https://www.are.na/oauth/authorize')),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(String(result.reason)).not.toContain('touched chrome.identity');
        }
      }
    });
  });

  it('declares supportsOAuth as a plain boolean capability flag', () => {
    // The plan explicitly allows this to be false (token paste-in only) until the
    // tab-based flow lands, and to flip true once it does — either is valid, so this
    // only pins the type, not the current value.
    expect(typeof safariPlatform.supportsOAuth).toBe('boolean');
  });

  it('keeps token paste-in available, since its OAuth flow depends on a page we host', () => {
    // Chrome and Firefox redirect through the browser itself and need no second
    // path; Safari's redirect is a GitHub Pages URL, so an outage or a repo rename
    // must degrade sign-in rather than break it.
    expect(safariPlatform.offersTokenSignIn).toBe(true);
    expect(chromePlatform.offersTokenSignIn).toBe(false);
    expect(firefoxPlatform.offersTokenSignIn).toBe(false);
  });
});

// The Safari redirect URL, the manifest's host_permissions, and the URI registered
// on the Are.na OAuth application have to agree exactly, and two of the three live
// in this repo. core/auth.ts validates the callback with an exact
// `origin + pathname` comparison, so a drift between them fails sign-in closed.
describe('safari oauth redirect contract', () => {
  const redirectUrl = readFileSync(resolve(root, 'src/platform/safari.ts'), 'utf8')
    .match(/const SAFARI_OAUTH_REDIRECT_URL = '([^']*)'/)?.[1];

  it('points at an https URL with an explicit file path', () => {
    expect(redirectUrl).toBeTruthy();
    const url = new URL(redirectUrl as string);
    expect(url.protocol).toBe('https:');
    // A bare directory path would be 301'd to a trailing slash by GitHub Pages,
    // changing `pathname` and failing core/auth.ts's exact comparison.
    expect(url.pathname).toMatch(/\.html$/);
    expect(url.search).toBe('');
  });

  it('is served by the page this repo publishes', () => {
    const url = new URL(redirectUrl as string);
    const published = resolve(root, 'site', url.pathname.split('/').pop() as string);
    expect(existsSync(published)).toBe(true);
  });

  it('is covered by the Safari manifest host_permissions', () => {
    const origin = new URL(redirectUrl as string).origin;
    // host_permissions is not the `permissions` key, so scripts/build-manifest.mjs
    // replaces rather than appends it — the overlay must restate api.are.na itself.
    const overlay = JSON.parse(readFileSync(resolve(root, 'public/manifest.safari.json'), 'utf8')) as {
      host_permissions?: string[];
    };
    const hostPermissions = overlay.host_permissions ?? [];
    // Without host access to this origin, tabs.onUpdated withholds changeInfo.url
    // and the flow's watcher never sees the callback.
    expect(hostPermissions.some((pattern) => pattern.startsWith(origin))).toBe(true);
    expect(hostPermissions).toContain('https://api.are.na/*');
  });
});
