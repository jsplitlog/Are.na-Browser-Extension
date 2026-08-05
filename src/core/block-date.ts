import type { ArenaBlock } from './types';

export const formatBlockCreatedDate = (
  createdAt: string | null,
  locale?: string,
): string | null => {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const formatOldestBlockAge = (
  blocks: Pick<ArenaBlock, 'createdAt'>[],
  now = Date.now(),
): string | null => {
  const timestamps = blocks.flatMap(({ createdAt }) => {
    if (!createdAt) return [];
    const timestamp = Date.parse(createdAt);
    return Number.isFinite(timestamp) ? [timestamp] : [];
  });
  if (!timestamps.length) return null;
  const elapsed = Math.max(0, now - Math.min(...timestamps));
  if (elapsed >= 365 * DAY) return `${Math.floor(elapsed / (365 * DAY))}y old`;
  if (elapsed >= 30 * DAY) return `${Math.floor(elapsed / (30 * DAY))}mo old`;
  if (elapsed >= 7 * DAY) return `${Math.floor(elapsed / (7 * DAY))}w old`;
  if (elapsed >= DAY) return `${Math.floor(elapsed / DAY)}d old`;
  if (elapsed >= HOUR) return `${Math.floor(elapsed / HOUR)}h old`;
  if (elapsed >= MINUTE) return `${Math.floor(elapsed / MINUTE)}m old`;
  return 'now';
};
