export type LookupStatus =
  | 'hit' | 'miss' | 'skipped' | 'unauthenticated' | 'not_premium' | 'error';

export interface ArenaBlock {
  id: number;
  title: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  blockType: string;                // 'Link' | 'Image' | 'Embed' | …
  userName: string | null;
  userSlug: string | null;
  userAvatarUrl: string | null;
  createdAt: string | null;
  connectionCount: number | null;   // meta.total_count, once known
}

export interface ArenaChannel {
  id: number;
  slug: string;
  title: string;
  ownerSlug: string | null;    // from `owner`, NOT `user` — see §2.7
  ownerName: string | null;
  status: string | null;       // 'public' | 'closed' | …
  webUrl: string;              // are.na/{ownerSlug}/{slug}, degraded if no owner
}

export interface LookupResult {
  normalizedUrl: string;
  status: LookupStatus;
  blocks: ArenaBlock[];
  fetchedAt: number;                              // epoch ms
  connections?: Record<number, ArenaChannel[]>;   // phase 2 only
}
