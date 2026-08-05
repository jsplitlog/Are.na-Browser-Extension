import './popup.css';
import { formatBlockCreatedDate } from '../core/block-date';
import { sortBlocks, type CopySort } from '../core/copy-sort';
import type { Request, Response } from '../core/messages';
import type { ArenaBlock, ArenaChannel, LookupResult } from '../core/types';

const app = document.querySelector<HTMLElement>('#app');

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

const clear = (): void => {
  if (app) app.replaceChildren();
};

const settingsButton = (): HTMLButtonElement => {
  const button = element('button', 'settings', 'Settings');
  button.type = 'button';
  button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  return button;
};

const renderFrame = (content: HTMLElement): void => {
  if (!app) return;
  clear();
  const brand = element('header', 'brand');
  brand.append(element('span', 'mark', 'Are.na'), element('span', 'brand-label', 'Connections'));
  app.append(brand, content, settingsButton());
};

const renderState = (title: string, detail?: string, action?: HTMLButtonElement): void => {
  const state = element('section', 'state');
  state.append(element('h1', undefined, title));
  if (detail) state.append(element('p', undefined, detail));
  if (action) state.append(action);
  renderFrame(state);
};

const send = async (request: Request): Promise<Response> => chrome.runtime.sendMessage(request) as Promise<Response>;

const visibleUrl = (normalizedUrl: string): string => {
  try {
    const value = new URL(`https://${normalizedUrl}`);
    return `${value.hostname}${value.pathname === '/' ? '' : value.pathname}`;
  } catch {
    return normalizedUrl;
  }
};

const renderPhaseOne = (result: LookupResult): void => {
  const content = element('section', 'results');
  const count = result.blocks.length;
  content.append(
    element('h1', undefined, `${count} ${count === 1 ? 'copy' : 'copies'} found`),
    element('p', 'url', visibleUrl(result.normalizedUrl)),
    element('div', 'channel-loading', 'Looking for public channels…'),
  );
  renderFrame(content);
};

const connectionLabel = (block: ArenaBlock, channels?: ArenaChannel[]): string | null => {
  const count = block.connectionCount ?? channels?.length;
  if (count === undefined || count === null) return null;
  return `${count} ${count === 1 ? 'channel' : 'channels'}`;
};

const avatarFallback = (block: ArenaBlock): HTMLSpanElement =>
  element('span', 'creator-avatar avatar-fallback', (block.userName || block.userSlug || 'A').slice(0, 1).toUpperCase());

const creatorLine = (block: ArenaBlock, channels?: ArenaChannel[]): HTMLSpanElement => {
  const line = element('span', 'block-creator');
  if (block.userAvatarUrl) {
    const avatar = element('img', 'creator-avatar');
    avatar.src = block.userAvatarUrl;
    avatar.alt = '';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.addEventListener('error', () => avatar.replaceWith(avatarFallback(block)), { once: true });
    line.append(avatar);
  } else {
    line.append(avatarFallback(block));
  }
  line.append(element('span', 'creator-name', block.userName || block.userSlug || 'Are.na user'));
  const createdDate = formatBlockCreatedDate(block.createdAt);
  if (createdDate) line.append(element('span', 'block-date', `· Created ${createdDate}`));
  const count = connectionLabel(block, channels);
  if (count) line.append(element('span', 'connection-count', `· ${count}`));
  return line;
};

const channelSummary = (channels?: ArenaChannel[]): string | null => {
  if (!channels?.length) return null;
  const names = channels.slice(0, 2).map((channel) => channel.title || 'Untitled channel');
  const remainder = channels.length - names.length;
  return `${names.join(', ')}${remainder > 0 ? ` +${remainder}` : ''}`;
};

const sortControl = (
  selected: CopySort,
  onChange: (sort: CopySort) => void,
): HTMLDivElement => {
  const control = element('div', 'copy-sort');
  const choices: Array<[CopySort, string]> = [
    ['most-connections', 'Most connections'],
    ['least-connections', 'Least connections'],
    ['newest', 'Newest'],
    ['oldest', 'Oldest'],
  ];
  const selectedIndex = Math.max(0, choices.findIndex(([value]) => value === selected));
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
    document.removeEventListener('click', handleOutsideClick);
    if (restoreFocus) trigger.focus();
  };

  const open = (focusIndex = selectedIndex): void => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', handleOutsideClick);
    options[focusIndex]?.focus();
  };

  function handleOutsideClick(event: MouseEvent): void {
    if (!control.contains(event.target as Node)) close();
  }

  for (const [value, label] of choices) {
    const option = element('button', 'copy-sort-option', label);
    option.type = 'button';
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(value === selected));
    option.addEventListener('click', () => {
      close();
      if (value !== selected) onChange(value);
      else trigger.focus();
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
    open(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, choices.length - 1));
  });
  menu.addEventListener('keydown', (event) => {
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
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

const renderConnections = (
  result: LookupResult,
  connections: Record<number, ArenaChannel[]>,
  sort: CopySort = 'most-connections',
): void => {
  const content = element('section', 'results');
  const blockCount = result.blocks.length;
  content.append(
    element('h1', undefined, `${blockCount} ${blockCount === 1 ? 'copy' : 'copies'} on Are.na`),
    element('p', 'url', visibleUrl(result.normalizedUrl)),
    sortControl(sort, (nextSort) => renderConnections(result, connections, nextSort)),
  );
  const list = element('div', 'block-list');
  for (const block of sortBlocks(result.blocks, connections, sort)) {
    const channels = connections[block.id];
    const link = element('a', 'block-copy');
    link.href = `https://www.are.na/block/${block.id}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = `Open Are.na block ${block.id}`;
    link.append(
      element('span', 'block-title', block.title || 'Untitled block'),
      creatorLine(block, channels),
    );
    const summary = channelSummary(channels);
    if (summary) link.append(element('span', 'block-channels', summary));
    list.append(link);
  }
  content.append(list);
  renderFrame(content);
};

const signInAction = (): HTMLButtonElement => {
  const button = element('button', 'primary', 'Open settings');
  button.type = 'button';
  button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  return button;
};

const renderLookupStatus = (result: LookupResult): void => {
  switch (result.status) {
    case 'unauthenticated':
      renderState('Sign in to Are.na to see connections.', undefined, signInAction());
      break;
    case 'not_premium':
      renderState('Are.na search requires a Premium account.', 'Your account is signed in, but URL search is a Premium feature.');
      break;
    case 'skipped':
      renderState("This kind of URL can't be looked up on Are.na.", 'There are not enough descriptive words in this address to search reliably.');
      break;
    case 'miss':
      renderState('No public connections found.', 'Search can miss pages whose address has little descriptive text.');
      break;
    default:
      renderState("Couldn't reach Are.na.", 'Check your connection and try opening the popup again.');
  }
};

const lookup = async (): Promise<void> => {
  renderState('Looking for connections…', 'Only this page is sent as search words when you ask.');
  try {
    // This is intentionally the only chrome.tabs access outside type declarations.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      renderState("This page can't be looked up.", 'Chrome did not provide an address for the active tab.');
      return;
    }
    const phaseOne = await send({ kind: 'lookup', url: tab.url });
    if (phaseOne.kind !== 'result') throw new Error('Unexpected lookup response');
    const result = phaseOne.result;
    if (result.status !== 'hit') {
      renderLookupStatus(result);
      return;
    }
    renderPhaseOne(result);
    const phaseTwo = await send({ kind: 'getConnections', normalizedUrl: result.normalizedUrl });
    if (phaseTwo.kind === 'result') {
      renderLookupStatus(phaseTwo.result);
      return;
    }
    if (phaseTwo.kind !== 'connections') throw new Error('Unexpected connections response');
    renderConnections(result, phaseTwo.connections);
  } catch {
    renderState("Couldn't reach Are.na.", 'Check your connection and try opening the popup again.');
  }
};

void lookup();
