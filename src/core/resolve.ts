import { getToken } from './auth';
import { ArenaError, createRequestBudget, getBlockConnections, searchBlocks, type RequestBudget } from './arena';
import { getCached, putCached } from './cache';
import { recordLookup } from './settings';
import type { ArenaChannel, LookupResult, LookupStatus } from './types';
import { classifyUrl, normalizeUrl } from './url';

const resultFor = (normalizedUrl: string, status: LookupStatus): LookupResult => ({
  normalizedUrl,
  status,
  blocks: [],
  fetchedAt: Date.now(),
});

const statusForError = (error: unknown): LookupStatus => {
  if (!(error instanceof ArenaError)) return 'error';
  if (error.kind === 'unauthenticated') return 'unauthenticated';
  if (error.kind === 'not_premium') return 'not_premium';
  return 'error';
};

export const blocksFor = async (
  url: string,
  budget: RequestBudget = createRequestBudget(),
): Promise<LookupResult> => {
  if (!(await getToken())) return resultFor(url, 'unauthenticated');
  const classification = classifyUrl(url);
  if (!classification.resolvable) {
    await recordLookup(false);
    return resultFor(url, 'skipped');
  }
  const normalizedUrl = normalizeUrl(url);
  const cached = await getCached(normalizedUrl);
  if (cached) {
    if (cached.status === 'miss') await recordLookup(false);
    return cached;
  }
  try {
    const blocks = await searchBlocks(url, budget);
    const result: LookupResult = {
      normalizedUrl,
      status: blocks.length ? 'hit' : 'miss',
      blocks,
      fetchedAt: Date.now(),
    };
    await putCached(result);
    if (!blocks.length) await recordLookup(false);
    return result;
  } catch (error) {
    return resultFor(normalizedUrl, statusForError(error));
  }
};

export const connectionsFor = async (
  result: LookupResult,
  budget?: RequestBudget,
): Promise<LookupResult> => {
  if (result.status !== 'hit') return result;
  const existingConnections = result.connections ?? {};
  const missingBlocks = result.blocks.filter(({ id }) =>
    !Object.prototype.hasOwnProperty.call(existingConnections, id));
  if (!missingBlocks.length) {
    try {
      await recordLookup(Object.values(existingConnections).some((channels) => channels.length > 0));
    } catch {
      // Lookup bookkeeping must not invalidate a usable result.
    }
    return result;
  }

  const ordered = [...missingBlocks]
    .sort((a, b) => (b.connectionCount ?? 0) - (a.connectionCount ?? 0));
  const activeBudget = budget ?? createRequestBudget(Math.max(8, ordered.length * 2));
  const pairs = (await Promise.all(ordered.map(async (block) => {
    try {
      const response = await getBlockConnections(block.id, activeBudget);
      block.connectionCount = response.total;
      return [block.id, response.channels] as const;
    } catch {
      return null;
    }
  }))).filter((pair): pair is readonly [number, ArenaChannel[]] => pair !== null);
  const completeConnections: Record<number, ArenaChannel[]> = {
    ...existingConnections,
    ...Object.fromEntries(pairs),
  };
  const complete: LookupResult = {
    ...result,
    blocks: [...result.blocks],
    connections: completeConnections,
  };
  try {
    await putCached(complete);
  } catch {
    // Cache writes are best-effort after a successful lookup.
  }
  try {
    await recordLookup(Object.values(completeConnections).some((channels) => channels.length > 0));
  } catch {
    // Lookup bookkeeping must not invalidate a usable result.
  }
  return complete;
};
