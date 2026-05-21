import type { TwitchSession } from '../background/twitch-api/types';
import type {
  AppState,
  PlaybackPrepResult,
  StreamerSelectionMode,
  TwitchGame,
  TwitchStreamer,
} from '../types';
import { browser } from './browser-api.ts';

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
  | { type: 'OPEN_DROPS_PAGE_AND_REFRESH'; payload?: { waitForRefresh?: boolean; active?: boolean } }
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
  ENSURE_GAMES_CACHE: {
    success: boolean;
    refreshed?: boolean;
    gamesCount?: number;
    games?: TwitchGame[];
    error?: string;
  };
  OPEN_DROPS_PAGE_AND_REFRESH: {
    success: boolean;
    opened?: boolean;
    refreshed?: boolean;
    gamesCount?: number;
    error?: string;
  };
  REFRESH_DROPS: { success: boolean; error?: string };
  UPDATE_GAMES: { success: boolean; error?: string };
  SYNC_TWITCH_SESSION: { success: boolean; error?: string };
  SYNC_TWITCH_INTEGRITY: { success: boolean; error?: string };
  PLAY_ALERT: { success: boolean; error?: string };
  OPEN_STREAMER: { success: boolean; error?: string };
};

const runtimeMessageTypeSet = new Set<string>(RUNTIME_MESSAGE_TYPES);

export function isRuntimeMessageType(value: unknown): value is RuntimeMessageType {
  return typeof value === 'string' && runtimeMessageTypeSet.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalBooleanPayload(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && (value.enabled === undefined || typeof value.enabled === 'boolean'))
  );
}

function isTwitchGameLike(value: unknown): value is TwitchGame {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.imageUrl === 'string'
  );
}

function hasGamePayload(value: unknown, allowMissingGame = false): boolean {
  if (!isRecord(value)) {
    return allowMissingGame && value === undefined;
  }
  return value.game === undefined ? allowMissingGame : isTwitchGameLike(value.game);
}

function isRuntimePayloadValid(type: RuntimeMessageType, payload: unknown): boolean {
  switch (type) {
    case 'START_FARMING':
      return hasGamePayload(payload, true);
    case 'ADD_TO_QUEUE':
      return hasGamePayload(payload, false);
    case 'SET_SELECTED_GAME':
      return isRecord(payload) && isTwitchGameLike(payload.game);
    case 'UPDATE_GAMES':
      return payload === undefined || (Array.isArray(payload) && payload.every(isTwitchGameLike));
    case 'SYNC_TWITCH_SESSION':
      return isRecord(payload);
    case 'SYNC_TWITCH_INTEGRITY':
      return (
        isRecord(payload) &&
        typeof payload.token === 'string' &&
        payload.token.trim().length > 0 &&
        (payload.expiration === undefined || typeof payload.expiration === 'number') &&
        (payload.request_id === undefined || typeof payload.request_id === 'string')
      );
    case 'CHANNEL_POINTS_BONUS_CLAIMED':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.channelName === undefined ||
            payload.channelName === null ||
            typeof payload.channelName === 'string'))
      );
    case 'REMOVE_FROM_QUEUE':
      return (
        isRecord(payload) &&
        (payload.game === undefined || isTwitchGameLike(payload.game)) &&
        (payload.gameId === undefined || typeof payload.gameId === 'string') &&
        (payload.campaignId === undefined || typeof payload.campaignId === 'string')
      );
    case 'OPEN_DROPS_PAGE_AND_REFRESH':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.waitForRefresh === undefined || typeof payload.waitForRefresh === 'boolean') &&
          (payload.active === undefined || typeof payload.active === 'boolean'))
      );
    case 'ENSURE_GAMES_CACHE':
      return (
        payload === undefined ||
        (isRecord(payload) && (payload.force === undefined || typeof payload.force === 'boolean'))
      );
    case 'OPEN_MONITOR_DASHBOARD':
      return (
        payload === undefined ||
        (isRecord(payload) && (payload.toggle === undefined || typeof payload.toggle === 'boolean'))
      );
    case 'SET_MONITOR_AUTO_OPEN':
    case 'SET_AUTO_RESUME_ON_STARTUP':
    case 'SET_MUTE_FARMING_TAB':
    case 'SET_NOTIFICATIONS_ENABLED':
    case 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS':
    case 'SET_AUTO_CLAIM_DROPS':
      return isOptionalBooleanPayload(payload);
    case 'SET_STREAMER_SELECTION_MODE':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.mode === undefined ||
            payload.mode === 'low-view' ||
            payload.mode === 'random' ||
            payload.mode === 'top-viewers'))
      );
    case 'SET_PREFERRED_STREAMER_LANGUAGE':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.language === undefined ||
            payload.language === null ||
            typeof payload.language === 'string'))
      );
    case 'PLAY_ALERT':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.kind === undefined ||
            payload.kind === 'all-complete' ||
            payload.kind === 'drop-complete') &&
          (payload.message === undefined || typeof payload.message === 'string'))
      );
    case 'OPEN_STREAMER':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.game === undefined || isTwitchGameLike(payload.game)) &&
          (payload.streamer === undefined || isRecord(payload.streamer)))
      );
    case 'GET_TWITCH_SESSION':
    case 'GET_STREAM_CONTEXT':
    case 'PREPARE_STREAM_PLAYBACK':
    case 'CLAIM_CHANNEL_POINTS_BONUS':
    case 'CLEAR_QUEUE':
    case 'PAUSE_FARMING':
    case 'RESUME_FARMING':
    case 'STOP_FARMING':
    case 'REFRESH_DROPS':
    case 'UPDATE_STATE':
      return true;
    default:
      return true;
  }
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return isRuntimeMessageType(type) && isRuntimePayloadValid(type, (value as { payload?: unknown }).payload);
}

export async function sendRuntimeMessage<T extends RuntimeRequest['type']>(
  request: Extract<RuntimeRequest, { type: T }>,
): Promise<RuntimeResponseByType[T] | undefined> {
  return (await browser.runtime.sendMessage(request)) as RuntimeResponseByType[T] | undefined;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled runtime message: ${String(value)}`);
}
