import { describe, expect, it } from 'vitest';
import { formatBlockCreatedDate, formatOldestBlockAge } from '../src/core/block-date';

describe('block creation date formatting', () => {
  it('formats the immutable creation date in UTC', () => {
    expect(formatBlockCreatedDate('2026-08-05T23:30:00Z', 'en-US')).toBe('Aug 5, 2026');
  });

  it('omits missing and invalid dates', () => {
    expect(formatBlockCreatedDate(null, 'en-US')).toBeNull();
    expect(formatBlockCreatedDate('not-a-date', 'en-US')).toBeNull();
  });

  it('formats the age of the oldest valid matching block', () => {
    const now = Date.parse('2026-08-05T00:00:00Z');
    expect(formatOldestBlockAge([
      { createdAt: '2021-08-05T00:00:00Z' },
      { createdAt: '2024-08-05T00:00:00Z' },
      { createdAt: 'not-a-date' },
    ], now)).toBe('5y');
    expect(formatOldestBlockAge([{ createdAt: '2026-07-20T00:00:00Z' }], now)).toBe('2w');
  });

  it('omits an age when no block has a valid creation date', () => {
    expect(formatOldestBlockAge([{ createdAt: null }, { createdAt: 'invalid' }])).toBeNull();
  });
});
