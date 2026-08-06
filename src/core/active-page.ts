export const ACTIVE_PAGE_KEY = 'arenaActivePage';

export interface ActivePageRequest {
  url: string;
  requestedAt: number;
}

export const isActivePageRequest = (value: unknown): value is ActivePageRequest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === 'string'
    && candidate.url.trim().length > 0
    && typeof candidate.requestedAt === 'number'
    && Number.isFinite(candidate.requestedAt)
    && candidate.requestedAt >= 0;
};
