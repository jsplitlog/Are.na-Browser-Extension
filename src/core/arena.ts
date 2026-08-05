import { getToken, signOut } from './auth';
import type { ArenaBlock, ArenaChannel } from './types';
import { buildQueries, normalizeUrl } from './url';

const API = 'https://api.are.na/v3';
const TYPES = 'Link,Embed,Image';
const SEARCH_PER_PAGE = 50;

export type ArenaErrorKind = 'unauthenticated' | 'not_premium' | 'rate_limited' | 'network';

/** A recoverable, user-facing API failure.  No API failure is represented as an empty result. */
export class ArenaError extends Error {
  constructor(
    public readonly kind: ArenaErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ArenaError';
  }
}

export interface RequestBudget {
  /** Number of requests still available to this lookup. */
  remaining: number;
}

export const createRequestBudget = (maximum = 10): RequestBudget => ({ remaining: maximum });

let activeRequests = 0;
const queue: Array<() => void> = [];
let pausedUntil = 0;

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const takeSlot = async (): Promise<void> => {
  if (activeRequests >= 3) await new Promise<void>((resolve) => queue.push(resolve));
  activeRequests += 1;
  const delay = pausedUntil - Date.now();
  if (delay > 0) await sleep(delay);
};

const releaseSlot = (): void => {
  activeRequests -= 1;
  queue.shift()?.();
};

const consume = (budget?: RequestBudget): void => {
  if (!budget) return;
  if (budget.remaining <= 0) throw new ArenaError('network', 'Request budget exhausted');
  budget.remaining -= 1;
};

const resetPauseFrom = (response: Response): void => {
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (Number.isFinite(reset) && reset > 0) pausedUntil = Math.max(pausedUntil, reset * 1000);
};

async function request(path: string, params: Record<string, string>, authenticated: boolean, budget?: RequestBudget): Promise<unknown> {
  const query = new URLSearchParams(params);
  const url = `${API}${path}${query.size ? `?${query}` : ''}`;
  const token = authenticated ? await getToken() : null;
  if (authenticated && !token) throw new ArenaError('unauthenticated', 'Sign in to search Are.na', 401);

  // A 403/5xx gets one retry. A 429 is retried after the server's reset time.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    consume(budget);
    await takeSlot();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch {
      releaseSlot();
      if (attempt === 0) {
        await sleep(250);
        continue;
      }
      throw new ArenaError('network', 'Unable to reach Are.na');
    }
    releaseSlot();

    if (response.status === 401) {
      await signOut();
      throw new ArenaError('unauthenticated', 'Are.na rejected this token', 401);
    }
    if (response.status === 402) throw new ArenaError('not_premium', 'Are.na search requires Premium', 402);
    if (response.status === 429) {
      resetPauseFrom(response);
      if (attempt === 0) continue;
      throw new ArenaError('rate_limited', 'Are.na rate limit reached', 429);
    }
    if (response.status === 403 || response.status >= 500) {
      if (attempt === 0) {
        await sleep(250);
        continue;
      }
      throw new ArenaError('network', `Are.na request failed (${response.status})`, response.status);
    }
    if (!response.ok) throw new ArenaError('network', `Are.na request failed (${response.status})`, response.status);
    try {
      return await response.json();
    } catch {
      throw new ArenaError('network', 'Are.na returned invalid JSON', response.status);
    }
  }
  throw new ArenaError('network', 'Are.na request failed');
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asString = (value: unknown): string | null => typeof value === 'string' ? value : null;
const asNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const imageSource = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  const image = asRecord(value);
  return image ? asString(image.src) ?? asString(image.url) : null;
};

const parseBlock = (value: unknown): ArenaBlock | null => {
  const block = asRecord(value);
  const id = block && asNumber(block.id);
  if (!block || id === null) return null;
  const source = asRecord(block.source);
  const image = asRecord(block.image);
  const user = asRecord(block.user);
  return {
    id,
    title: asString(block.title),
    sourceUrl: source ? asString(source.url) : null,
    imageUrl: image ? asString(image.display_url) ?? asString(image.original_url) : null,
    blockType: asString(block.class) ?? asString(block.type) ?? 'Unknown',
    userName: user ? asString(user.full_name) ?? asString(user.name) : null,
    userSlug: user ? asString(user.slug) : null,
    userAvatarUrl: user ? imageSource(user.avatar) : null,
    createdAt: asString(block.created_at),
    connectionCount: asNumber(block.connections_count) ?? asNumber(block.connection_count),
  };
};

const parseChannel = (value: unknown): ArenaChannel | null => {
  const channel = asRecord(value);
  const id = channel && asNumber(channel.id);
  const slug = channel && asString(channel.slug);
  if (!channel || id === null || !slug) return null;
  const owner = asRecord(channel.owner);
  const ownerSlug = owner ? asString(owner.slug) : null;
  return {
    id,
    slug,
    title: asString(channel.title) ?? slug,
    ownerSlug,
    ownerName: owner ? asString(owner.full_name) ?? asString(owner.name) : null,
    status: asString(channel.status),
    webUrl: `https://www.are.na/${ownerSlug ? `${ownerSlug}/` : ''}${slug}`,
  };
};

const mergeBlock = (existing: ArenaBlock, incoming: ArenaBlock): ArenaBlock => ({
  ...incoming,
  title: incoming.title ?? existing.title,
  sourceUrl: incoming.sourceUrl ?? existing.sourceUrl,
  imageUrl: incoming.imageUrl ?? existing.imageUrl,
  blockType: incoming.blockType === 'Unknown' ? existing.blockType : incoming.blockType,
  userName: incoming.userName ?? existing.userName,
  userSlug: incoming.userSlug ?? existing.userSlug,
  userAvatarUrl: incoming.userAvatarUrl ?? existing.userAvatarUrl,
  createdAt: incoming.createdAt ?? existing.createdAt,
  connectionCount: incoming.connectionCount ?? existing.connectionCount,
});

/** Finds blocks whose stored source URL exactly equals this URL after normalization. */
export const searchBlocks = async (url: string, budget?: RequestBudget): Promise<ArenaBlock[]> => {
  const target = normalizeUrl(url);
  const found = new Map<number, ArenaBlock>();
  for (const query of buildQueries(url).slice(0, 2)) {
    const body = asRecord(await request('/search', { query, type: TYPES, per: String(SEARCH_PER_PAGE) }, true, budget));
    const data = body && Array.isArray(body.data) ? body.data : [];
    for (const raw of data) {
      const block = parseBlock(raw);
      let sourceMatches = false;
      if (block?.sourceUrl) {
        try {
          sourceMatches = normalizeUrl(block.sourceUrl) === target;
        } catch {
          // Search results are untrusted data. One malformed source must not
          // discard valid exact matches from the rest of the response.
        }
      }
      if (block && sourceMatches) {
        const existing = found.get(block.id);
        found.set(block.id, existing ? mergeBlock(existing, block) : block);
      }
    }
    if (found.size >= 5) break;
  }
  return [...found.values()];
};

/** Fetches the channel where the block was first connected. */
export const getBlockConnections = async (id: number, budget?: RequestBudget): Promise<{ channels: ArenaChannel[]; total: number }> => {
  const body = asRecord(await request(
    `/blocks/${encodeURIComponent(String(id))}/connections`,
    { per: '1', sort: 'created_at_asc' },
    false,
    budget,
  ));
  const data = body && Array.isArray(body.data) ? body.data : [];
  const meta = body ? asRecord(body.meta) : null;
  const channels = data.map(parseChannel).filter((channel): channel is ArenaChannel => channel !== null);
  return {
    channels,
    total: asNumber(meta?.total_count) ?? asNumber(meta?.total) ?? channels.length,
  };
};
