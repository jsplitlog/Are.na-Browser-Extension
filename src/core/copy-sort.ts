import type { ArenaBlock, ArenaChannel } from './types';

export type CopySort = 'most-connections' | 'least-connections' | 'newest' | 'oldest';
export type CopySortAxis = 'connections' | 'date';

export interface ConnectionCountSummary {
  count: number;
  complete: boolean;
  known: number;
}

export const summarizeConnectionCounts = (blocks: ArenaBlock[]): ConnectionCountSummary => ({
  count: blocks.reduce((total, { connectionCount }) => total + (connectionCount ?? 0), 0),
  complete: blocks.every(({ connectionCount }) => connectionCount !== null),
  known: blocks.filter(({ connectionCount }) => connectionCount !== null).length,
});

export const nextCopySort = (current: CopySort, axis: CopySortAxis): CopySort => {
  if (axis === 'connections') {
    return current === 'most-connections' ? 'least-connections' : 'most-connections';
  }
  return current === 'newest' ? 'oldest' : 'newest';
};

const connectionCount = (block: ArenaBlock, connections: Record<number, ArenaChannel[]>): number | null =>
  block.connectionCount ?? connections[block.id]?.length ?? null;

const createdTime = (block: ArenaBlock): number | null => {
  if (!block.createdAt) return null;
  const value = Date.parse(block.createdAt);
  return Number.isFinite(value) ? value : null;
};

export const sortBlocks = (
  blocks: ArenaBlock[],
  connections: Record<number, ArenaChannel[]>,
  sort: CopySort,
): ArenaBlock[] => [...blocks].sort((a, b) => {
  if (sort === 'most-connections' || sort === 'least-connections') {
    const aCount = connectionCount(a, connections);
    const bCount = connectionCount(b, connections);
    if (aCount === null && bCount === null) return 0;
    if (aCount === null) return 1;
    if (bCount === null) return -1;
    return sort === 'most-connections' ? bCount - aCount : aCount - bCount;
  }
  const aTime = createdTime(a);
  const bTime = createdTime(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return sort === 'newest' ? bTime - aTime : aTime - bTime;
});
