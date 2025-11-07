export interface TwitchGame {
  id: string;
  name: string;
  imageUrl: string;
}

export interface TwitchDrop {
  id: string;
  name: string;
  gameId: string;
  gameName: string;
  imageUrl: string;
  progress: number; // 0-100
  claimed: boolean;
  benefitName?: string;
}

export interface TwitchStreamer {
  id: string;
  name: string;
  displayName: string;
  isLive: boolean;
  viewerCount?: number;
  thumbnailUrl?: string;
}

export interface AppState {
  selectedGame: TwitchGame | null;
  isRunning: boolean;
  isPaused: boolean;
  activeStreamer: TwitchStreamer | null;
  currentDrop: TwitchDrop | null;
  completedDrops: TwitchDrop[];
  availableGames: TwitchGame[];
  tabId: number | null;
}

export interface StorageData {
  state: AppState;
  lastUpdate: number;
}

export type MessageType =
  | 'GET_DROPS_DATA'
  | 'START_FARMING'
  | 'PAUSE_FARMING'
  | 'RESUME_FARMING'
  | 'STOP_FARMING'
  | 'UPDATE_STATE'
  | 'FETCH_GAMES'
  | 'UPDATE_GAMES'
  | 'OPEN_STREAMER';

export interface Message {
  type: MessageType;
  payload?: any;
}
