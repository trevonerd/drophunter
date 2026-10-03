import type { AppState } from '../types/index.ts';
export const BACKUP_SETTINGS = {
  monitorAutoOpen: 'boolean',
  muteFarmingTab: 'boolean',
  notificationsEnabled: 'boolean',
  autoClaimChannelPointsBonus: 'boolean',
  autoClaimDrops: 'boolean',
  autoStartFavoriteGames: 'boolean',
  streamerSelectionMode: ['low-view', 'random', 'top-viewers'],
  preferredStreamerLanguage: 'nullable-string',
  campaignPriorityMode: ['ending-soonest', 'lowest-availability', 'priority-list-only'],
  farmCategoryScope: ['all', 'favorites-only'],
  watchTransportPreference: ['managed-tab', 'tabless'],
} as const;
export type BackupSettings = Partial<Pick<AppState, keyof typeof BACKUP_SETTINGS>>;
