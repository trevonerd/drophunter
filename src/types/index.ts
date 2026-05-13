export interface TwitchGame {
  id: string;
  name: string;
  displayName?: string;
  campaignName?: string;
  imageUrl: string;
  categorySlug?: string;
  campaignId?: string;
  endsAt?: string | null;
  expiresInMs?: number | null;
  expiryStatus?: ExpiryStatus;
  dropCount?: number;
  isConnected?: boolean;
  allDropsCompleted?: boolean;
  allowedChannels?: string[] | null; // null = any channel, string[] = restricted to these logins
}

export interface TwitchDrop {
  id: string;
  claimId?: string;
  name: string;
  gameId: string;
  gameName: string;
  imageUrl: string;
  categorySlug?: string;
  progress: number; // 0-100
  currentMinutes: number; // raw watched minutes from API
  claimed: boolean;
  claimable?: boolean;
  benefitName?: string;
  campaignId?: string;
  endsAt?: string | null;
  expiresInMs?: number | null;
  status?: DropStatus;
  requiredMinutes?: number | null;
  remainingMinutes?: number | null;
  progressSource?: DropProgressSource;
  dropType?: DropType;
}

export interface TwitchStreamer {
  id: string;
  name: string;
  displayName: string;
  isLive: boolean;
  viewerCount?: number;
  broadcasterLanguage?: string;
  thumbnailUrl?: string;
}

export type ExpiryStatus = 'safe' | 'warning' | 'urgent' | 'unknown';
export type DropType = 'time-based' | 'event-based';
export type StreamerSelectionMode = 'low-view' | 'random' | 'top-viewers';

export type DropStatus = 'active' | 'pending' | 'completed';
export type DropProgressSource = 'campaign' | 'inventory';

export interface DropsSnapshot {
  games: TwitchGame[];
  drops: TwitchDrop[];
  campaignChannelsMap?: Record<string, string[] | null>;
  updatedAt: number;
}

export interface AppState {
  selectedGame: TwitchGame | null;
  isRunning: boolean;
  isPaused: boolean;
  monitorAutoOpen: boolean;
  autoResumeOnStartup: boolean;
  muteFarmingTab: boolean;
  notificationsEnabled: boolean;
  autoClaimChannelPointsBonus: boolean;
  autoClaimDrops: boolean;
  totalDropsClaimed: number;
  totalChannelPointsClaimed: number;
  streamerSelectionMode: StreamerSelectionMode;
  preferredStreamerLanguage: string | null;
  activeStreamer: TwitchStreamer | null;
  currentDrop: TwitchDrop | null;
  completedDrops: TwitchDrop[];
  pendingDrops: TwitchDrop[];
  allDrops: TwitchDrop[];
  availableGames: TwitchGame[];
  queue: TwitchGame[];
  monitorWindowId: number | null;
  tabId: number | null;
  completionNotified: boolean;
  lastSuccessfulRefreshAt?: number;
  dropsPageRefreshInProgress: boolean;
  lastRotationReason?: string | null;
  lastRotationAt?: number | null;
  recoveryReason?: string | null;
  recoveryBackoffUntil?: number | null;
  recoveryAttempts?: number | null;
  resumedFromCrash?: number | null;
  lastStopReason?: string | null;
  lastStopMessage?: string | null;
}

export interface StorageData {
  state: AppState;
  lastUpdate: number;
}

export interface PlaybackPrepResult {
  gateDismissed?: boolean;
  isPlaybackReady?: boolean;
  userInteractionRequired?: boolean;
}
