import { describe, expect, it } from 'vitest';
import { sortBlocks } from '../src/core/copy-sort';
import type { ArenaBlock, ArenaChannel } from '../src/core/types';

const block = (id: number, createdAt: string | null, connectionCount: number | null): ArenaBlock => ({
  id,
  title: null,
  sourceUrl: null,
  imageUrl: null,
  blockType: 'Link',
  userName: null,
  userSlug: null,
  userAvatarUrl: null,
  createdAt,
  connectionCount,
});

const blocks = [
  block(1, '2026-01-01T00:00:00Z', 2),
  block(2, '2026-03-01T00:00:00Z', null),
  block(3, '2026-02-01T00:00:00Z', 7),
  block(4, null, 1),
];
const connections: Record<number, ArenaChannel[]> = { 2: [{}, {}, {}] as ArenaChannel[] };

describe('copy sorting', () => {
  it('sorts by known connection totals, falling back to loaded rows', () => {
    expect(sortBlocks(blocks, connections, 'most-connections').map(({ id }) => id)).toEqual([3, 2, 1, 4]);
    expect(sortBlocks(blocks, connections, 'least-connections').map(({ id }) => id)).toEqual([4, 1, 2, 3]);
  });

  it('sorts newest and oldest while leaving unknown dates last', () => {
    expect(sortBlocks(blocks, connections, 'newest').map(({ id }) => id)).toEqual([2, 3, 1, 4]);
    expect(sortBlocks(blocks, connections, 'oldest').map(({ id }) => id)).toEqual([1, 3, 2, 4]);
  });

  it('does not mutate the resolver result order', () => {
    sortBlocks(blocks, connections, 'most-connections');
    expect(blocks.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
  });
});
