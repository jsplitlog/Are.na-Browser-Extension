import './sidepanel.css';
import { ACTIVE_PAGE_KEY, isActivePageRequest } from '../core/active-page';
import { formatBlockCreatedDate } from '../core/block-date';
import { nextCopySort, sortBlocks, totalConnectionCount, type CopySort } from '../core/copy-sort';
import type { Request, Response } from '../core/messages';
import type { ArenaBlock, ArenaChannel, LookupResult } from '../core/types';

const app = document.querySelector<HTMLElement>('#app');

let currentResult: LookupResult | null = null;
let currentConnections: Record<number, ArenaChannel[]> = {};
let connectionsLoaded = false;
let currentSort: CopySort = 'most-connections';
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
  if (!action) state.append(settingsButton());
  replaceApp(state);
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
  const content = element('span', 'metadata-content');
  content.append(element('span', 'metadata-creator', block.userName || block.userSlug || 'Are.na user'));
  const details = element('span', 'metadata-details');
  const date = formatBlockCreatedDate(block.createdAt);
  if (date) details.append(element('span', 'metadata-item metadata-muted', date));
  const count = connectionCount(block);
  if (count) details.append(element('span', 'metadata-item metadata-muted', count));
  if (details.childElementCount) content.append(details);
  row.append(creatorAvatar(block), content);
  return row;
};

const isOpenChannel = (channel?: ArenaChannel): boolean =>
  channel?.status === 'open' || channel?.status === 'public';

const originatingChannelTitle = (channels?: ArenaChannel[]): string => {
  if (channels === undefined) return connectionsLoaded ? 'Channel unavailable' : 'Loading channel…';
  return channels[0]?.title || 'Channel unavailable';
};

const sortControl = (selected: CopySort, onChange: (sort: CopySort) => void): HTMLDivElement => {
  const control = element('div', 'copy-sort');
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Sort blocks');

  const connectionsActive = selected === 'most-connections' || selected === 'least-connections';
  const connectionsDirection = selected === 'least-connections' ? 'ascending' : 'descending';
  const connections = element(
    'button',
    `sort-button sort-${connectionsDirection}`,
    'Connections',
  );
  connections.type = 'button';
  connections.setAttribute('aria-pressed', String(connectionsActive));
  connections.setAttribute(
    'aria-label',
    connectionsActive
      ? `Connections, ${connectionsDirection === 'descending' ? 'most' : 'least'} first. Reverse order.`
      : 'Sort by connections, most first.',
  );
  connections.addEventListener('click', () => {
    onChange(nextCopySort(selected, 'connections'));
  });

  const dateActive = selected === 'newest' || selected === 'oldest';
  const dateDirection = selected === 'oldest' ? 'ascending' : 'descending';
  const date = element('button', `sort-button sort-${dateDirection}`, 'Date');
  date.type = 'button';
  date.setAttribute('aria-pressed', String(dateActive));
  date.setAttribute(
    'aria-label',
    dateActive
      ? `Date, ${dateDirection === 'descending' ? 'newest' : 'oldest'} first. Reverse order.`
      : 'Sort by date, newest first.',
  );
  date.addEventListener('click', () => {
    onChange(nextCopySort(selected, 'date'));
  });

  control.append(connections, date);
  return control;
};

const resultContext = (result: LookupResult): HTMLElement => {
  const context = element('section', 'result-context');
  const blockCount = result.blocks.length;
  const connectionCount = totalConnectionCount(result.blocks);
  const totals = element('div', 'result-metadata');
  totals.append(
    element('span', 'result-total', `${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}`),
    element(
      'span',
      'result-total',
      connectionCount === null
        ? connectionsLoaded ? 'Connections unavailable' : 'Loading connections…'
        : `${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`,
    ),
    settingsButton(),
  );
  context.append(element('h1', 'result-title', visibleUrl(result.normalizedUrl)), totals);
  return context;
};

const renderMaster = (preserveScroll = false): void => {
  const result = currentResult;
  if (!result) {
    renderIdle();
    return;
  }
  const scrollPosition = preserveScroll ? window.scrollY : 0;
  const page = element('div', 'master-view');
  const context = resultContext(result);
  const toolbar = element('div', 'master-toolbar');
  toolbar.append(sortControl(currentSort, (nextSort) => {
    currentSort = nextSort;
    renderMaster();
    window.scrollTo({ top: 0 });
  }));

  const list = element('ul', 'block-list');
  list.setAttribute('aria-label', 'Blocks on Are.na');
  for (const block of sortBlocks(result.blocks, currentConnections, currentSort)) {
    const channels = currentConnections[block.id];
    const channel = channels?.[0];
    const item = element('li', 'block-list-item');
    const copy = element('a', 'block-copy');
    copy.href = `https://www.are.na/block/${encodeURIComponent(String(block.id))}`;
    copy.target = '_blank';
    copy.rel = 'noopener';
    if (isOpenChannel(channel)) copy.classList.add('channel-open');
    copy.append(element('span', 'channel-title', originatingChannelTitle(channels)), metadata(block));
    item.append(copy);
    list.append(item);
  }

  page.append(context, toolbar, list);
  replaceApp(page);
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
};

const startLookup = async (url: string): Promise<void> => {
  const generation = ++requestGeneration;
  currentResult = null;
  currentConnections = {};
  connectionsLoaded = false;
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
      connectionsLoaded = true;
      renderMaster(true);
      return;
    }
    if (phaseTwo.kind !== 'connections') throw new Error('Unexpected connections response');
    for (const block of currentResult.blocks) {
      const count = phaseTwo.connectionCounts[block.id];
      if (count !== undefined) block.connectionCount = count;
    }
    currentConnections = phaseTwo.connections;
    connectionsLoaded = true;
    renderMaster(true);
  } catch {
    if (generation === requestGeneration) {
      if (currentResult) {
        connectionsLoaded = true;
        renderMaster(true);
      } else {
        renderState('Couldn’t reach Are.na.');
      }
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
    connectionsLoaded = false;
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
