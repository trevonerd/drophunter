import type { AppState, TwitchGame } from '../types/index.ts';

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isExpiredGame(game: TwitchGame): boolean {
  if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)) {
    return game.expiresInMs <= 0;
  }
  if (game.endsAt) {
    const endsAtMs = new Date(game.endsAt).getTime();
    if (Number.isFinite(endsAtMs)) {
      return endsAtMs <= Date.now();
    }
  }
  return false;
}

export const createInitialState = (): AppState => ({
  selectedGame: null,
  isRunning: false,
  isPaused: false,
  monitorAutoOpen: true,
  autoResumeOnStartup: false,
  muteFarmingTab: true,
  notificationsEnabled: false,
  telegramAlertsEnabled: false,
  autoClaimChannelPointsBonus: true,
  autoClaimDrops: true,
  totalDropsClaimed: 0,
  totalChannelPointsClaimed: 0,
  streamerSelectionMode: 'low-view',
  preferredStreamerLanguage: null,
  activeStreamer: null,
  currentDrop: null,
  completedDrops: [],
  pendingDrops: [],
  allDrops: [],
  availableGames: [],
  queue: [],
  monitorWindowId: null,
  tabId: null,
  completionNotified: false,
  twitchSessionDetected: false,
  dropsPageRefreshInProgress: false,
  lastDropsPageRefreshAttemptAt: null,
  lastDropsPageRefreshCompletedAt: null,
  lastDropsPageRefreshCampaignCount: null,
  lastDropsPageRefreshNoticeSeenAt: null,
  lastDropsPageRefreshError: null,
  lastRotationReason: null,
  lastRotationAt: null,
  recoveryReason: null,
  recoveryBackoffUntil: null,
  recoveryAttempts: null,
  resumedFromCrash: null,
  lastStopReason: null,
  lastStopMessage: null,
});
