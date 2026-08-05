import './sidepanel.css';
import { ACTIVE_PAGE_KEY, isActivePageRequest } from '../core/active-page';
import { formatBlockCreatedDate } from '../core/block-date';
import { sortBlocks, type CopySort } from '../core/copy-sort';
import type { Request, Response } from '../core/messages';
import type { ArenaBlock, ArenaChannel, LookupResult } from '../core/types';

const app = document.querySelector<HTMLElement>('#app');

type View = { kind: 'master' } | { kind: 'detail'; blockId: number };

let currentResult: LookupResult | null = null;
let currentConnections: Record<number, ArenaChannel[]> = {};
let currentSort: CopySort = 'most-connections';
let currentView: View = { kind: 'master' };
let masterScrollPosition = 0;
let requestGeneration = 0;
let latestRequestedAt = -1;
let latestRequestUrl = '';

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const send = async (request: Request): Promise<Response> =>
  chrome.runtime.sendMessage(request) as Promise<Response>;

const visibleUrl = (normalizedUrl: string): string => {
  try {
    const value = new URL(`https://${normalizedUrl}`);
    return `${value.hostname}${value.pathname === '/' ? '' : value.pathname}`;
  } catch {
    return normalizedUrl;
  }
};

const settingsButton = (): HTMLButtonElement => {
  const button = element('button', 'settings-button', 'Settings');
  button.type = 'button';
  button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  return button;
};

const siteHeader = (): HTMLElement => {
  const header = element('header', 'site-header');
  const brand = element('div', 'brand');
  brand.append(element('span', 'brand-mark', 'Are.na'), element('span', 'brand-label', 'Connections'));
  header.append(brand, settingsButton());
  return header;
};

const replaceApp = (...nodes: Node[]): void => {
  app?.replaceChildren(...nodes);
};

const renderState = (
  title: string,
  detail?: string,
  action?: HTMLButtonElement,
  busy = false,
): void => {
  const state = element('section', 'state');
  state.setAttribute('role', busy ? 'status' : 'region');
  if (busy) state.setAttribute('aria-live', 'polite');
  state.append(element('h1', 'state-title', title));
  if (detail) state.append(element('p', 'state-detail', detail));
  if (action) state.append(action);
  replaceApp(siteHeader(), state);
};

const renderIdle = (): void => {
  renderState('No page selected.', 'Click the toolbar button to check this page.');
};

const signInAction = (): HTMLButtonElement => {
  const button = element('button', 'primary-button', 'Open settings');
  button.type = 'button';
  button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  return button;
};

const renderLookupStatus = (result: LookupResult): void => {
  switch (result.status) {
    case 'unauthenticated':
      renderState('Sign in required.', undefined, signInAction());
      break;
    case 'not_premium':
      renderState('Premium required.', 'Are.na search requires Premium.');
      break;
    case 'skipped':
      renderState('Can’t look up this page.');
      break;
    case 'miss':
      renderState('Nothing found.');
      break;
    default:
      renderState('Couldn’t reach Are.na.');
  }
};

const avatarFallback = (block: ArenaBlock): HTMLSpanElement =>
  element(
    'span',
    'creator-avatar avatar-fallback',
    (block.userName || block.userSlug || 'A').slice(0, 1).toUpperCase(),
  );

const creatorAvatar = (block: ArenaBlock, className = ''): HTMLElement => {
  if (!block.userAvatarUrl) return avatarFallback(block);
  const avatar = element('img', `creator-avatar ${className}`.trim());
  avatar.src = block.userAvatarUrl;
  avatar.alt = '';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.addEventListener('error', () => avatar.replaceWith(avatarFallback(block)), { once: true });
  return avatar;
};

const connectionCount = (block: ArenaBlock): string | null => {
  const count = block.connectionCount;
  if (count === null) return null;
  return `${count} ${count === 1 ? 'connection' : 'connections'}`;
};

const metadata = (block: ArenaBlock): HTMLElement => {
  const row = element('span', 'block-metadata');
  const creator = element('span', 'metadata-item metadata-creator');
  creator.append(creatorAvatar(block), element('span', undefined, block.userName || block.userSlug || 'Are.na user'));
  row.append(creator);
  const date = formatBlockCreatedDate(block.createdAt);
  if (date) row.append(element('span', 'metadata-item metadata-muted', date));
  const count = connectionCount(block);
  if (count) row.append(element('span', 'metadata-item metadata-muted', count));
  return row;
};

const originatingChannel = (channels?: ArenaChannel[]): HTMLElement | null => {
  const channel = channels?.[0];
  if (!channel) return null;
  const label = element('span', 'originating-channel');
  label.append(element('span', 'originating-label', 'Original channel'));
  label.append(element('span', 'originating-title', channel.title || 'Untitled channel'));
  return label;
};

const sortControl = (selected: CopySort, onChange: (sort: CopySort) => void): HTMLDivElement => {
  const choices: Array<[CopySort, string]> = [
    ['most-connections', 'Most connections'],
    ['least-connections', 'Least connections'],
    ['newest', 'Newest'],
    ['oldest', 'Oldest'],
  ];
  const selectedIndex = Math.max(0, choices.findIndex(([value]) => value === selected));
  const control = element('div', 'copy-sort');
  const trigger = element('button', 'copy-sort-trigger', choices[selectedIndex]?.[1] ?? 'Sort copies');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `Sort copies: ${choices[selectedIndex]?.[1] ?? 'Sort copies'}`);

  const menu = element('div', 'copy-sort-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Sort copies');
  const options: HTMLButtonElement[] = [];

  const close = (restoreFocus = false): void => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', handleOutsidePress);
    if (restoreFocus) trigger.focus();
  };

  const open = (focusIndex = selectedIndex): void => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', handleOutsidePress);
    options[focusIndex]?.focus();
  };

  function handleOutsidePress(event: PointerEvent): void {
    if (!control.contains(event.target as Node)) close();
  }

  for (const [value, label] of choices) {
    const option = element('button', 'copy-sort-option', label);
    option.type = 'button';
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(value === selected));
    option.addEventListener('click', () => {
      close();
      if (value === selected) {
        trigger.focus();
        return;
      }
      onChange(value);
    });
    options.push(option);
    menu.append(option);
  }

  trigger.addEventListener('click', () => {
    if (menu.hidden) open();
    else close(true);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowDown' ? selectedIndex : choices.length - 1);
  });
  menu.addEventListener('keydown', (event) => {
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      options[nextIndex]?.focus();
    }
  });

  control.append(trigger, menu);
  return control;
};

const resultContext = (result: LookupResult): HTMLElement => {
  const context = element('section', 'result-context');
  const count = result.blocks.length;
  context.append(
    element('h1', 'result-title', `${count} ${count === 1 ? 'copy' : 'copies'}`),
    element('p', 'result-url', visibleUrl(result.normalizedUrl)),
  );
  return context;
};

const renderMaster = (restoreScroll = false): void => {
  const result = currentResult;
  if (!result) {
    renderIdle();
    return;
  }
  const page = element('div', 'master-view');
  const header = siteHeader();
  const context = resultContext(result);
  const toolbar = element('div', 'master-toolbar');
  toolbar.append(element('span', 'toolbar-label', 'Sort'), sortControl(currentSort, (nextSort) => {
    currentSort = nextSort;
    masterScrollPosition = 0;
    renderMaster();
    window.scrollTo({ top: 0 });
  }));

  const list = element('ul', 'block-list');
  list.setAttribute('aria-label', 'Copies on Are.na');
  for (const block of sortBlocks(result.blocks, currentConnections, currentSort)) {
    const channels = currentConnections[block.id];
    const item = element('li', 'block-list-item');
    const copy = element('button', 'block-copy');
    copy.type = 'button';
    copy.append(element('span', 'block-title', block.title || 'Untitled block'), metadata(block));
    const origin = originatingChannel(channels);
    if (origin) copy.append(origin);
    copy.addEventListener('click', () => {
      masterScrollPosition = window.scrollY;
      currentView = { kind: 'detail', blockId: block.id };
      renderDetail(block);
      window.scrollTo({ top: 0 });
    });
    item.append(copy);
    list.append(item);
  }

  page.append(header, context, toolbar, list);
  replaceApp(page);
  if (restoreScroll) requestAnimationFrame(() => window.scrollTo({ top: masterScrollPosition }));
};

const blockImage = (block: ArenaBlock): HTMLImageElement | null => {
  if (!block.imageUrl) return null;
  const image = element('img', 'detail-image');
  image.src = block.imageUrl;
  image.alt = block.title ? `Preview of ${block.title}` : 'Block preview';
  image.addEventListener('error', () => image.remove(), { once: true });
  return image;
};

const renderDetail = (block: ArenaBlock, focusBack = true): void => {
  const channels = currentConnections[block.id];
  const page = element('div', 'detail-view');
  const navigation = element('header', 'detail-navigation');
  const back = element('button', 'back-button', 'All copies');
  back.type = 'button';
  back.setAttribute('aria-label', 'Back to copies');
  back.addEventListener('click', () => {
    currentView = { kind: 'master' };
    renderMaster(true);
  });
  navigation.append(back, settingsButton());

  const article = element('article', 'block-detail');
  const image = blockImage(block);
  if (image) article.append(image);
  const body = element('div', 'detail-body');
  body.append(element('h1', 'detail-title', block.title || 'Untitled block'), metadata(block));
  const origin = originatingChannel(channels);
  if (origin) body.append(origin);

  const open = element('a', 'arena-link', 'Open block');
  open.href = `https://www.are.na/block/${encodeURIComponent(String(block.id))}`;
  open.target = '_blank';
  open.rel = 'noopener';
  body.append(open);
  article.append(body);
  page.append(navigation, article);
  replaceApp(page);
  if (focusBack) requestAnimationFrame(() => back.focus());
};

const renderCurrentView = (preserveScroll = false): void => {
  if (!currentResult) {
    renderIdle();
    return;
  }
  if (currentView.kind === 'detail') {
    const { blockId } = currentView;
    const block = currentResult.blocks.find(({ id }) => id === blockId);
    if (block) {
      renderDetail(block, false);
      return;
    }
    currentView = { kind: 'master' };
  }
  if (preserveScroll) masterScrollPosition = window.scrollY;
  renderMaster(preserveScroll);
};

const startLookup = async (url: string): Promise<void> => {
  const generation = ++requestGeneration;
  currentResult = null;
  currentConnections = {};
  currentView = { kind: 'master' };
  masterScrollPosition = 0;
  renderState('Looking up page…', undefined, undefined, true);

  try {
    const phaseOne = await send({ kind: 'lookup', url });
    if (generation !== requestGeneration) return;
    if (phaseOne.kind !== 'result') throw new Error('Unexpected lookup response');
    if (phaseOne.result.status !== 'hit') {
      renderLookupStatus(phaseOne.result);
      return;
    }

    currentResult = phaseOne.result;
    renderMaster();

    const phaseTwo = await send({ kind: 'getConnections', normalizedUrl: phaseOne.result.normalizedUrl });
    if (generation !== requestGeneration) return;
    if (phaseTwo.kind === 'result') {
      renderLookupStatus(phaseTwo.result);
      return;
    }
    if (phaseTwo.kind !== 'connections') throw new Error('Unexpected connections response');
    for (const block of currentResult.blocks) {
      const count = phaseTwo.connectionCounts[block.id];
      if (count !== undefined) block.connectionCount = count;
    }
    currentConnections = phaseTwo.connections;
    renderCurrentView(currentView.kind === 'master');
  } catch {
    if (generation === requestGeneration) {
      renderState('Couldn’t reach Are.na.');
    }
  }
};

const handleActivePage = (value: unknown): void => {
  if (!isActivePageRequest(value)) {
    ++requestGeneration;
    latestRequestedAt = -1;
    latestRequestUrl = '';
    currentResult = null;
    currentConnections = {};
    currentView = { kind: 'master' };
    renderIdle();
    return;
  }
  if (value.requestedAt < latestRequestedAt) return;
  if (value.requestedAt === latestRequestedAt && value.url === latestRequestUrl) return;
  latestRequestedAt = value.requestedAt;
  latestRequestUrl = value.url;
  void startLookup(value.url);
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session') return;
  const change = changes[ACTIVE_PAGE_KEY];
  if (change) handleActivePage(change.newValue);
});

const initialize = async (): Promise<void> => {
  renderIdle();
  try {
    const stored = await chrome.storage.session.get(ACTIVE_PAGE_KEY);
    handleActivePage(stored[ACTIVE_PAGE_KEY]);
  } catch {
    renderIdle();
  }
};

void initialize();
