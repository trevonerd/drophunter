import type { TwitchSession } from '../background/twitch-api/types';
import type {
  AppState,
  PlaybackPrepResult,
  StreamerSelectionMode,
  TwitchGame,
  TwitchStreamer,
} from '../types';

export const RUNTIME_MESSAGE_TYPES = [
  'GET_TWITCH_SESSION',
  'GET_STREAM_CONTEXT',
  'PREPARE_STREAM_PLAYBACK',
  'CLAIM_CHANNEL_POINTS_BONUS',
  'CHANNEL_POINTS_BONUS_CLAIMED',
  'OPEN_MONITOR_DASHBOARD',
  'SET_MONITOR_AUTO_OPEN',
  'SET_AUTO_RESUME_ON_STARTUP',
  'SET_MUTE_FARMING_TAB',
  'SET_NOTIFICATIONS_ENABLED',
  'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS',
  'SET_AUTO_CLAIM_DROPS',
  'SET_STREAMER_SELECTION_MODE',
  'SET_PREFERRED_STREAMER_LANGUAGE',
  'ADD_TO_QUEUE',
  'REMOVE_FROM_QUEUE',
  'CLEAR_QUEUE',
  'START_FARMING',
  'SET_SELECTED_GAME',
  'PAUSE_FARMING',
  'RESUME_FARMING',
  'STOP_FARMING',
  'UPDATE_STATE',
  'ENSURE_GAMES_CACHE',
  'OPEN_DROPS_PAGE_AND_REFRESH',
  'REFRESH_DROPS',
  'UPDATE_GAMES',
  'SYNC_TWITCH_SESSION',
  'SYNC_TWITCH_INTEGRITY',
  'PLAY_ALERT',
  'OPEN_STREAMER',
] as const;

export type RuntimeMessageType = (typeof RUNTIME_MESSAGE_TYPES)[number];

export type RuntimeRequest =
  | { type: 'GET_TWITCH_SESSION' }
  | { type: 'GET_STREAM_CONTEXT' }
  | { type: 'PREPARE_STREAM_PLAYBACK' }
  | { type: 'CLAIM_CHANNEL_POINTS_BONUS' }
  | { type: 'CHANNEL_POINTS_BONUS_CLAIMED'; payload?: { channelName?: string | null } }
  | { type: 'OPEN_MONITOR_DASHBOARD'; payload?: { toggle?: boolean } }
  | { type: 'SET_MONITOR_AUTO_OPEN'; payload?: { enabled?: boolean } }
  | { type: 'SET_AUTO_RESUME_ON_STARTUP'; payload?: { enabled?: boolean } }
  | { type: 'SET_MUTE_FARMING_TAB'; payload?: { enabled?: boolean } }
  | { type: 'SET_NOTIFICATIONS_ENABLED'; payload?: { enabled?: boolean } }
  | { type: 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS'; payload?: { enabled?: boolean } }
  | { type: 'SET_AUTO_CLAIM_DROPS'; payload?: { enabled?: boolean } }
  | { type: 'SET_STREAMER_SELECTION_MODE'; payload?: { mode?: StreamerSelectionMode } }
  | { type: 'SET_PREFERRED_STREAMER_LANGUAGE'; payload?: { language?: string | null } }
  | { type: 'ADD_TO_QUEUE'; payload: { game?: TwitchGame } }
  | { type: 'REMOVE_FROM_QUEUE'; payload: { game?: TwitchGame; gameId?: string; campaignId?: string } }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'START_FARMING'; payload: { game?: TwitchGame } }
  | { type: 'SET_SELECTED_GAME'; payload: { game: TwitchGame } }
  | { type: 'PAUSE_FARMING' }
  | { type: 'RESUME_FARMING' }
  | { type: 'STOP_FARMING' }
  | { type: 'UPDATE_STATE'; payload: AppState }
  | { type: 'ENSURE_GAMES_CACHE'; payload?: { force?: boolean } }
  | { type: 'OPEN_DROPS_PAGE_AND_REFRESH' }
  | { type: 'REFRESH_DROPS' }
  | { type: 'UPDATE_GAMES'; payload?: TwitchGame[] }
  | { type: 'SYNC_TWITCH_SESSION'; payload?: { session?: unknown } | unknown }
  | { type: 'SYNC_TWITCH_INTEGRITY'; payload?: { token?: string; expiration?: number; request_id?: string } }
  | { type: 'PLAY_ALERT'; payload?: { kind?: 'all-complete' | 'drop-complete'; message?: string } }
  | { type: 'OPEN_STREAMER'; payload?: { streamer?: TwitchStreamer; game?: TwitchGame } };

export type RuntimeResponseByType = {
  GET_TWITCH_SESSION: { success: boolean; session?: TwitchSession | null; error?: string };
  GET_STREAM_CONTEXT: { success: boolean; context?: unknown; error?: string };
  PREPARE_STREAM_PLAYBACK: { success: boolean } & PlaybackPrepResult;
  CLAIM_CHANNEL_POINTS_BONUS: { success: boolean; claimed?: boolean; reason?: string; error?: string };
  CHANNEL_POINTS_BONUS_CLAIMED: { success: boolean; error?: string };
  OPEN_MONITOR_DASHBOARD: { success: boolean; monitorWindowId?: number | null; error?: string };
  SET_MONITOR_AUTO_OPEN: { success: boolean; monitorAutoOpen?: boolean; error?: string };
  SET_AUTO_RESUME_ON_STARTUP: { success: boolean; autoResumeOnStartup?: boolean; error?: string };
  SET_MUTE_FARMING_TAB: { success: boolean; muteFarmingTab?: boolean; error?: string };
  SET_NOTIFICATIONS_ENABLED: { success: boolean; notificationsEnabled?: boolean; error?: string };
  SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS: {
    success: boolean;
    autoClaimChannelPointsBonus?: boolean;
    error?: string;
  };
  SET_AUTO_CLAIM_DROPS: { success: boolean; autoClaimDrops?: boolean; error?: string };
  SET_STREAMER_SELECTION_MODE: {
    success: boolean;
    streamerSelectionMode?: StreamerSelectionMode;
    error?: string;
  };
  SET_PREFERRED_STREAMER_LANGUAGE: {
    success: boolean;
    preferredStreamerLanguage?: string | null;
    error?: string;
  };
  ADD_TO_QUEUE: { success: boolean; added?: boolean; reason?: string; error?: string };
  REMOVE_FROM_QUEUE: { success: boolean; removed?: boolean; error?: string };
  CLEAR_QUEUE: { success: boolean; error?: string };
  START_FARMING: { success: boolean; error?: string };
  SET_SELECTED_GAME: { success: boolean; selectedGame?: TwitchGame | null; error?: string };
  PAUSE_FARMING: { success: boolean; error?: string };
  RESUME_FARMING: { success: boolean; error?: string };
  STOP_FARMING: { success: boolean; error?: string };
  UPDATE_STATE: { success: boolean; error?: string };
  ENSURE_GAMES_CACHE: { success: boolean; gamesCount?: number; error?: string };
  OPEN_DROPS_PAGE_AND_REFRESH: { success: boolean; gamesCount?: number; error?: string };
  REFRESH_DROPS: { success: boolean; error?: string };
  UPDATE_GAMES: { success: boolean; error?: string };
  SYNC_TWITCH_SESSION: { success: boolean; error?: string };
  SYNC_TWITCH_INTEGRITY: { success: boolean; error?: string };
  PLAY_ALERT: { success: boolean; error?: string };
  OPEN_STREAMER: { success: boolean; error?: string };
};

const runtimeMessageTypeSet = new Set<string>(RUNTIME_MESSAGE_TYPES);

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && runtimeMessageTypeSet.has(type);
}

export async function sendRuntimeMessage<T extends RuntimeRequest['type']>(
  request: Extract<RuntimeRequest, { type: T }>,
): Promise<RuntimeResponseByType[T] | undefined> {
  return (await chrome.runtime.sendMessage(request)) as RuntimeResponseByType[T] | undefined;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled runtime message: ${String(value)}`);
}
