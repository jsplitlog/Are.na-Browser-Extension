export const ACTIVE_PAGE_KEY = 'arenaActivePage';

export interface ActivePageRequest {
  url: string;
  requestedAt: number;
}

type SessionStorage = Pick<chrome.storage.StorageArea, 'get'>;

export const isActivePageRequest = (value: unknown): value is ActivePageRequest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === 'string'
    && candidate.url.trim().length > 0
    && typeof candidate.requestedAt === 'number'
    && Number.isFinite(candidate.requestedAt)
    && candidate.requestedAt >= 0;
};

/** Reads the latest user-requested page from session-only extension storage. */
export const readActivePageRequest = async (
  storage: SessionStorage = chrome.storage.session,
): Promise<ActivePageRequest | null> => {
  const stored = await storage.get(ACTIVE_PAGE_KEY);
  const candidate = stored[ACTIVE_PAGE_KEY];
  return isActivePageRequest(candidate) ? candidate : null;
};
