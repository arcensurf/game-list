import type { ShardPlatform } from '../hooks/useAchievementList';

// Shared by LeaderboardView, LeaderboardGameModal, and PlatformPill —
// plain constants/functions, kept out of any component file so those
// stay component-only (mixing breaks Vite Fast Refresh for the file).
export const PLATFORM_LABELS: Record<ShardPlatform, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
  ra: 'RA',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
