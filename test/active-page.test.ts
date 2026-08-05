import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_PAGE_KEY,
  isActivePageRequest,
  readActivePageRequest,
} from '../src/core/active-page';

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

  it('reads a validated request from the provided storage area', async () => {
    const request = { url: 'https://example.com/work', requestedAt: 42 };
    const storage = {
      get: vi.fn(async () => ({ [ACTIVE_PAGE_KEY]: request })),
    } as unknown as Pick<chrome.storage.StorageArea, 'get'>;

    await expect(readActivePageRequest(storage)).resolves.toEqual(request);
    expect(storage.get).toHaveBeenCalledWith(ACTIVE_PAGE_KEY);
  });

  it('returns null for invalid session data', async () => {
    const storage = {
      get: vi.fn(async () => ({ [ACTIVE_PAGE_KEY]: { url: 7, requestedAt: 42 } })),
    } as unknown as Pick<chrome.storage.StorageArea, 'get'>;

    await expect(readActivePageRequest(storage)).resolves.toBeNull();
  });
});
