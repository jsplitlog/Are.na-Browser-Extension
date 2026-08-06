import { describe, expect, it } from 'vitest';
import { isActivePageRequest } from '../src/core/active-page';

describe('active page request', () => {
  it('accepts a page request from an explicit toolbar action', () => {
    expect(isActivePageRequest({ url: 'https://example.com/work', requestedAt: 42 })).toBe(true);
  });

  it.each([
    null,
    {},
    { url: '', requestedAt: 42 },
    { url: '   ', requestedAt: 42 },
    { url: 'https://example.com', requestedAt: Number.NaN },
    { url: 'https://example.com', requestedAt: -1 },
  ])('rejects malformed stored data: %j', (value) => {
    expect(isActivePageRequest(value)).toBe(false);
  });
});
