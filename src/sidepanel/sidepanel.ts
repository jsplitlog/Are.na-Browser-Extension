import './sidepanel.css';
import { ACTIVE_PAGE_KEY, isActivePageRequest } from '../core/active-page';
import { formatBlockCreatedDate, formatOldestBlockAge } from '../core/block-date';
import { nextCopySort, sortBlocks, summarizeConnectionCounts, type CopySort } from '../core/copy-sort';
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
const SOURCE_URL = 'https://github.com/jsplitlog/arena-connections';

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

const githubIcon = (): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('auth-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const crown = document.createElementNS(namespace, 'path');
  crown.setAttribute('d', 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4');
  const branch = document.createElementNS(namespace, 'path');
  branch.setAttribute('d', 'M9 18c-4.51 2-5-2-7-2');
  svg.append(crown, branch);
  return svg;
};

const logOutButton = (): HTMLButtonElement => {
  const button = element('button', 'log-out-button', 'Log out');
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await send({ kind: 'signOut' });
      if (response.kind === 'error') throw new Error(response.message);
      if (response.kind !== 'ok') throw new Error('Could not log out.');
      ++requestGeneration;
      currentResult = null;
      currentConnections = {};
      connectionsLoaded = false;
      renderSignIn();
    } catch {
      button.disabled = false;
      button.textContent = 'Try log out again';
    }
  });
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
  if (!action) state.append(logOutButton());
  replaceApp(state);
};

const renderIdle = (): void => {
  renderState('No page selected.', 'Click the toolbar button to check this page.');
};

const renderSignIn = (errorMessage = ''): void => {
  const view = element('section', 'auth-view');
  const card = element('div', 'auth-card');
  const copy = element('div', 'auth-card-copy');
  copy.append(
    element('h1', 'auth-title', 'Are.na Connections'),
    element('p', 'auth-description', 'Explore Are.na connections from any page.'),
  );

  const button = element('button', 'auth-primary', 'Sign in with Are.na ✶✶');
  button.type = 'button';
  const message = element('p', 'auth-message', errorMessage);
  message.setAttribute('role', 'alert');
  message.setAttribute('aria-live', 'polite');

  const footer = element('div', 'auth-footer');
  const remember = element('label', 'auth-remember');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  remember.append(checkbox, document.createTextNode('Remember device'));
  const source = element('a', 'auth-link');
  source.href = SOURCE_URL;
  source.target = '_blank';
  source.rel = 'noopener';
  source.append(githubIcon(), document.createTextNode('View source'));
  footer.append(remember, source);

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Connecting…';
    message.textContent = '';
    try {
      const response = await send({ kind: 'signIn', remember: checkbox.checked });
      if (response.kind === 'error') throw new Error(response.message);
      if (response.kind !== 'ok') throw new Error('Could not sign in with Are.na.');
      if (latestRequestUrl) await startLookup(latestRequestUrl);
      else renderIdle();
    } catch (error) {
      renderSignIn(error instanceof Error ? error.message : 'Could not sign in with Are.na.');
    }
  });

  card.append(copy, button, message, footer);
  view.append(card);
  replaceApp(view);
  requestAnimationFrame(() => button.focus());
};

const renderLookupStatus = (result: LookupResult): void => {
  switch (result.status) {
    case 'unauthenticated':
      renderSignIn();
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

const metadata = (block: ArenaBlock, channelTitle: string): HTMLElement => {
  const row = element('span', 'block-metadata');
  const content = element('span', 'metadata-content');
  content.append(element('span', 'metadata-creator', block.userName || block.userSlug || 'Are.na user'));
  const details = element('span', 'metadata-details');
  const date = formatBlockCreatedDate(block.createdAt);
  if (date) details.append(element('span', 'metadata-item metadata-muted', date));
  const count = connectionCount(block);
  if (count) details.append(element('span', 'metadata-item metadata-muted', count));
  row.append(element('span', 'channel-title', channelTitle));
  row.append(creatorAvatar(block), content);
  if (details.childElementCount) row.append(details);
  return row;
};

const isOpenChannel = (channel?: ArenaChannel): boolean =>
  channel?.visibility === 'open' || channel?.visibility === 'public';

const originatingChannelTitle = (channels?: ArenaChannel[]): string => {
  if (channels === undefined) return connectionsLoaded ? 'Channel unavailable' : 'Loading channel…';
  return channels[0]?.title || 'Channel unavailable';
};

const sortChevron = (direction: 'ascending' | 'descending'): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('sort-chevron');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', direction === 'descending' ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6');
  svg.append(path);
  return svg;
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
  if (connectionsActive) connections.append(sortChevron(connectionsDirection));
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
  if (dateActive) date.append(sortChevron(dateDirection));
  date.addEventListener('click', () => {
    onChange(nextCopySort(selected, 'date'));
  });

  control.append(connections, date);
  return control;
};

const resultContext = (result: LookupResult): HTMLElement => {
  const context = element('section', 'result-context');
  const blockCount = result.blocks.length;
  const connectionSummary = summarizeConnectionCounts(result.blocks);
  const blockAge = formatOldestBlockAge(result.blocks);
  const totals = element('div', 'result-metadata');
  const connectionLabel = connectionSummary.complete
    ? `${connectionSummary.count} ${connectionSummary.count === 1 ? 'connection' : 'connections'}`
    : !connectionsLoaded
      ? 'Loading connections…'
      : connectionSummary.known > 0
        ? `${connectionSummary.count}+ connections`
        : 'Connections unavailable';
  totals.append(
    element('span', 'result-total', `${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}`),
    element('span', 'result-total', connectionLabel),
  );
  if (blockAge) totals.append(element('span', 'result-total', blockAge));
  totals.append(logOutButton());
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
    copy.append(metadata(block, originatingChannelTitle(channels)));
    item.append(copy);
    list.append(item);
  }

  page.append(context, toolbar, list);
  replaceApp(page);
  if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
};

const startLookup = async (url: string): Promise<void> => {
  const generation = ++requestGeneration;

  try {
    const auth = await send({ kind: 'getAuthState' });
    if (generation !== requestGeneration) return;
    if (auth.kind === 'error') throw new Error(auth.message);
    if (auth.kind !== 'authState') throw new Error('Unexpected account response');
    if (!auth.signedIn) {
      currentResult = null;
      currentConnections = {};
      connectionsLoaded = false;
      renderSignIn();
      return;
    }

    currentResult = null;
    currentConnections = {};
    connectionsLoaded = false;
    renderState('Looking up page…', undefined, undefined, true);

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
  try {
    const [stored, auth] = await Promise.all([
      chrome.storage.session.get(ACTIVE_PAGE_KEY),
      send({ kind: 'getAuthState' }),
    ]);
    const activePage = stored[ACTIVE_PAGE_KEY];
    if (auth.kind === 'authState' && !auth.signedIn) {
      if (isActivePageRequest(activePage)) {
        latestRequestedAt = activePage.requestedAt;
        latestRequestUrl = activePage.url;
      }
      renderSignIn();
      return;
    }
    if (isActivePageRequest(activePage)) {
      handleActivePage(activePage);
      return;
    }
    renderIdle();
  } catch {
    renderIdle();
  }
};

void initialize();
