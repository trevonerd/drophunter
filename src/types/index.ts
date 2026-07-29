export type RewardAcquisitionMethod = 'watch-time' | 'subscription' | 'other-event' | 'unknown';
export type RewardKind = 'in-game' | 'twitch-badge' | 'twitch-emote' | 'unknown';
export type RewardVerificationState = 'unassessed' | 'verified' | 'unverifiable';
export type CampaignCompletion = 'farmable' | 'farming-complete' | 'all-acquired';
export type CampaignRemainderReason = 'subscription-required' | 'unverifiable-twitch';

export type CampaignRewardSummary = {
  readonly completion: CampaignCompletion;
  readonly remainderReasons: readonly CampaignRemainderReason[];
};

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
  rewardSummary?: CampaignRewardSummary;
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
  acquisitionMethod: RewardAcquisitionMethod;
  rewardKind: RewardKind;
  verificationState: RewardVerificationState;
  benefitIds?: string[];
  rewardDistributionTypes?: string[];
  startsAt?: string | null;
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
  telegramAlertsEnabled: boolean;
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
  // Sticky: set true the first time a Twitch session is detected from any
  // source (storage/tab/content-script). Used to tell "never signed in" apart
  // from "signed in but 0 active campaigns" in the popup empty state.
  twitchSessionDetected: boolean;
  dropsPageRefreshInProgress: boolean;
  lastDropsPageRefreshAttemptAt?: number | null;
  lastDropsPageRefreshCompletedAt?: number | null;
  lastDropsPageRefreshCampaignCount?: number | null;
  lastDropsPageRefreshNoticeSeenAt?: number | null;
  lastDropsPageRefreshError?: string | null;
  lastRotationReason?: string | null;
  lastRotationAt?: number | null;
  recoveryReason?: string | null;
  recoveryBackoffUntil?: number | null;
  recoveryAttempts?: number | null;
  resumedFromCrash?: number | null;
  lastStopReason?: string | null;
  lastStopMessage?: string | null;
}

export interface ClaimLogEntry {
  id: string;
  claimId?: string;
  dropId: string;
  dropName: string;
  benefitName?: string;
  gameId: string;
  gameName: string;
  campaignId?: string;
  campaignName?: string;
  campaignLabel: string;
  claimedAt: number;
  imageUrl?: string;
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
