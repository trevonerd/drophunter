export interface TwitchGame {
  id: string;
  name: string;
  imageUrl: string;
  categorySlug?: string;
  campaignId?: string;
  endsAt?: string | null;
  expiresInMs?: number | null;
  expiryStatus?: ExpiryStatus;
  dropCount?: number;
  isConnected?: boolean;
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
  thumbnailUrl?: string;
}

export type ExpiryStatus = 'safe' | 'warning' | 'urgent' | 'unknown';
export type DropType = 'time-based' | 'event-based';

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
}

export interface StorageData {
  state: AppState;
  lastUpdate: number;
}

export type MessageType =
  | 'GET_TWITCH_SESSION'
  | 'GET_STREAM_CONTEXT'
  | 'PREPARE_STREAM_PLAYBACK'
  | 'OPEN_MONITOR_DASHBOARD'
  | 'ADD_TO_QUEUE'
  | 'REMOVE_FROM_QUEUE'
  | 'CLEAR_QUEUE'
  | 'START_FARMING'
  | 'SET_SELECTED_GAME'
  | 'PAUSE_FARMING'
  | 'RESUME_FARMING'
  | 'STOP_FARMING'
  | 'UPDATE_STATE'
  | 'ENSURE_GAMES_CACHE'
  | 'REFRESH_DROPS'
  | 'UPDATE_GAMES'
  | 'SYNC_TWITCH_SESSION'
  | 'SYNC_TWITCH_INTEGRITY'
  | 'PLAY_ALERT'
  | 'OPEN_STREAMER';

export interface Message {
  type: MessageType;
  payload?: unknown;
}
