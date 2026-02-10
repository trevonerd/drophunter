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

export type DropStatus = 'active' | 'pending' | 'completed';
export type DropProgressSource = 'campaign' | 'inventory';

export interface DropsSnapshot {
  games: TwitchGame[];
  drops: TwitchDrop[];
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
  workspaceWindowId: number | null;
  monitorWindowId: number | null;
  tabId: number | null;
  directoryTabId: number | null;
  dropsTabId: number | null;
  inventoryTabId: number | null;
  completionNotified: boolean;
}

export interface StorageData {
  state: AppState;
  lastUpdate: number;
}

export type MessageType =
  | 'GET_DROPS_DATA'
  | 'FETCH_DROPS_DATA'
  | 'GET_TWITCH_SESSION'
  | 'GET_STREAM_CONTEXT'
  | 'GET_DIRECTORY_STREAMERS'
  | 'GET_CATEGORY_SUGGESTIONS'
  | 'FETCH_INVENTORY_DATA'
  | 'EXPAND_GAME_ACCORDION'
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
  | 'FETCH_GAMES'
  | 'ENSURE_GAMES_CACHE'
  | 'REFRESH_DROPS'
  | 'UPDATE_GAMES'
  | 'SYNC_DROPS_DATA'
  | 'SYNC_TWITCH_SESSION'
  | 'SYNC_TWITCH_INTEGRITY'
  | 'PLAY_ALERT'
  | 'OPEN_STREAMER';

export interface Message {
  type: MessageType;
  payload?: any;
}
