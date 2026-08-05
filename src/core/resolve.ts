import { getToken } from './auth';
import { ArenaError, createRequestBudget, getBlockConnections, searchBlocks, type RequestBudget } from './arena';
import { getCached, putCached } from './cache';
import { recordLookup } from './settings';
import type { LookupResult, LookupStatus } from './types';
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
  budget: RequestBudget = createRequestBudget(8),
): Promise<LookupResult> => {
  if (result.status !== 'hit') return result;
  if (result.connections) {
    await recordLookup(Object.values(result.connections).some((channels) => channels.length > 0));
    return result;
  }
  try {
    const ordered = [...result.blocks]
      .sort((a, b) => (b.connectionCount ?? 0) - (a.connectionCount ?? 0))
      .slice(0, 8);
    const pairs = await Promise.all(ordered.map(async (block) => {
      const response = await getBlockConnections(block.id, budget);
      block.connectionCount = response.total;
      return [block.id, response.channels] as const;
    }));
    const complete: LookupResult = { ...result, blocks: [...result.blocks], connections: Object.fromEntries(pairs) };
    await putCached(complete);
    await recordLookup(pairs.some(([, channels]) => channels.length > 0));
    return complete;
  } catch (error) {
    return { ...result, status: statusForError(error), fetchedAt: Date.now() };
  }
};
