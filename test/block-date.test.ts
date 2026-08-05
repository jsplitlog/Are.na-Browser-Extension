import { describe, expect, it } from 'vitest';
import { formatBlockCreatedDate } from '../src/core/block-date';

describe('block creation date formatting', () => {
  it('formats the immutable creation date in UTC', () => {
    expect(formatBlockCreatedDate('2026-08-05T23:30:00Z', 'en-US')).toBe('Aug 5, 2026');
  });

  it('omits missing and invalid dates', () => {
    expect(formatBlockCreatedDate(null, 'en-US')).toBeNull();
    expect(formatBlockCreatedDate('not-a-date', 'en-US')).toBeNull();
  });
});
