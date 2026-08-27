import type { TwitchSession } from '../background/twitch-api/types';
import type {
  ActivationSyncResult,
  AppState,
  CampaignPriorityMode,
  ClaimLogEntry,
  FarmCategoryScope,
  GamePreference,
  PlaybackPrepResult,
  StreamerSelectionMode,
  TwitchGame,
  TwitchStreamer,
  WatchTransportMode,
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
  'SET_TELEGRAM_ALERTS_ENABLED',
  'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED',
  'SET_TELEGRAM_CREDENTIALS',
  'TEST_TELEGRAM_ALERTS',
  'GET_TELEGRAM_SETTINGS',
  'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS',
  'SET_AUTO_CLAIM_DROPS',
  'SET_GAME_FAVORITE',
  'SET_GAME_PREFERENCE',
  'SET_CAMPAIGN_PRIORITY_MODE',
  'SET_FARM_CATEGORY_SCOPE',
  'SET_AUTO_START_FAVORITES',
  'SET_WATCH_TRANSPORT_MODE',
  'EVALUATE_AUTO_START',
  'SET_STREAMER_SELECTION_MODE',
  'SET_PREFERRED_STREAMER_LANGUAGE',
  'ADD_TO_QUEUE',
  'REMOVE_FROM_QUEUE',
  'REORDER_QUEUE',
  'CLEAR_QUEUE',
  'START_FARMING',
  'SET_SELECTED_GAME',
  'PAUSE_FARMING',
  'RESUME_FARMING',
  'STOP_FARMING',
  'UPDATE_STATE',
  'ACTIVATE_POPUP',
  'OPEN_DROPS_AND_SYNC',
  'ENSURE_GAMES_CACHE',
  'OPEN_DROPS_PAGE_AND_REFRESH',
  'MARK_DROPS_REFRESH_NOTICE_SEEN',
  'REFRESH_DROPS',
  'UPDATE_GAMES',
  'SYNC_TWITCH_SESSION',
  'SYNC_TWITCH_INTEGRITY',
  'PLAY_ALERT',
  'OPEN_STREAMER',
  'GET_CLAIM_LOG',
  'CLEAR_CLAIM_LOG',
] as const;

export type RuntimeMessageType = (typeof RUNTIME_MESSAGE_TYPES)[number];

export const BOOLEAN_TOGGLE_MESSAGES = {
  SET_MONITOR_AUTO_OPEN: { responseField: 'monitorAutoOpen' },
  SET_AUTO_RESUME_ON_STARTUP: { responseField: 'autoResumeOnStartup' },
  SET_MUTE_FARMING_TAB: { responseField: 'muteFarmingTab' },
  SET_NOTIFICATIONS_ENABLED: { responseField: 'notificationsEnabled' },
  SET_TELEGRAM_ALERTS_ENABLED: { responseField: 'telegramAlertsEnabled' },
  SET_TELEGRAM_SYSTEM_ALERTS_ENABLED: { responseField: 'telegramSystemAlertsEnabled' },
  SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS: { responseField: 'autoClaimChannelPointsBonus' },
  SET_AUTO_CLAIM_DROPS: { responseField: 'autoClaimDrops' },
  SET_AUTO_START_FAVORITES: { responseField: 'autoStartFavoriteGames' },
} as const satisfies Partial<Record<RuntimeMessageType, { responseField: keyof AppState }>>;

type BooleanToggleMessageType = keyof typeof BOOLEAN_TOGGLE_MESSAGES;
type BooleanToggleRequest = {
  [T in BooleanToggleMessageType]: { type: T; payload?: { enabled?: boolean } };
}[BooleanToggleMessageType];
type BooleanToggleResponseByType = {
  [T in BooleanToggleMessageType]: { success: boolean; error?: string } & {
    [F in (typeof BOOLEAN_TOGGLE_MESSAGES)[T]['responseField']]?: boolean;
  };
};

export const NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES = {
  TEST_TELEGRAM_ALERTS: {},
  CLEAR_QUEUE: {},
  PAUSE_FARMING: {},
  RESUME_FARMING: {},
  STOP_FARMING: {},
  REFRESH_DROPS: {},
} as const satisfies Partial<Record<RuntimeMessageType, Record<string, never>>>;

type MinimalMessageType = keyof typeof NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES;
type MinimalRequest = { [T in MinimalMessageType]: { type: T } }[MinimalMessageType];
type MinimalResponseByType = { [T in MinimalMessageType]: { success: boolean; error?: string } };

export const ADD_TO_QUEUE_REASONS = ['already-queued', 'already-completed', 'farming-complete'] as const;
export type AddToQueueReason = (typeof ADD_TO_QUEUE_REASONS)[number];

export type RuntimeRequest =
  | { type: 'GET_TWITCH_SESSION' }
  | { type: 'GET_STREAM_CONTEXT' }
  | { type: 'PREPARE_STREAM_PLAYBACK' }
  | { type: 'CLAIM_CHANNEL_POINTS_BONUS' }
  | { type: 'CHANNEL_POINTS_BONUS_CLAIMED'; payload?: { channelName?: string | null } }
  | { type: 'OPEN_MONITOR_DASHBOARD'; payload?: { toggle?: boolean } }
  | BooleanToggleRequest
  | MinimalRequest
  | {
      type: 'SET_TELEGRAM_CREDENTIALS';
      payload?: { botToken?: string; chatId?: string; clearToken?: boolean };
    }
  | { type: 'GET_TELEGRAM_SETTINGS' }
  | { type: 'EVALUATE_AUTO_START' }
  | { type: 'ACTIVATE_POPUP' }
  | { type: 'OPEN_DROPS_AND_SYNC' }
  | { type: 'GET_CLAIM_LOG' }
  | { type: 'CLEAR_CLAIM_LOG' }
  | { type: 'SET_STREAMER_SELECTION_MODE'; payload?: { mode?: StreamerSelectionMode } }
  | { type: 'SET_PREFERRED_STREAMER_LANGUAGE'; payload?: { language?: string | null } }
  | { type: 'SET_GAME_FAVORITE'; payload: { game: TwitchGame; favorite: boolean } }
  | { type: 'SET_GAME_PREFERENCE'; payload: { game: TwitchGame; preference: GamePreference } }
  | { type: 'SET_CAMPAIGN_PRIORITY_MODE'; payload: { mode: CampaignPriorityMode } }
  | { type: 'SET_FARM_CATEGORY_SCOPE'; payload: { scope: FarmCategoryScope } }
  | { type: 'SET_WATCH_TRANSPORT_MODE'; payload: { mode: WatchTransportMode } }
  | { type: 'ADD_TO_QUEUE'; payload: { game?: TwitchGame } }
  | { type: 'REMOVE_FROM_QUEUE'; payload: { game?: TwitchGame; gameId?: string; campaignId?: string } }
  | { type: 'REORDER_QUEUE'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'START_FARMING'; payload: { game?: TwitchGame } }
  | { type: 'SET_SELECTED_GAME'; payload: { game: TwitchGame } }
  | { type: 'UPDATE_STATE'; payload: AppState }
  | { type: 'ENSURE_GAMES_CACHE'; payload?: { force?: boolean } }
  | { type: 'OPEN_DROPS_PAGE_AND_REFRESH'; payload?: { waitForRefresh?: boolean; active?: boolean } }
  | { type: 'MARK_DROPS_REFRESH_NOTICE_SEEN'; payload?: { seenAt?: number } }
  | { type: 'UPDATE_GAMES'; payload?: TwitchGame[] }
  | { type: 'SYNC_TWITCH_SESSION'; payload?: { session?: unknown } | unknown }
  | { type: 'SYNC_TWITCH_INTEGRITY'; payload?: { token?: string; expiration?: number; request_id?: string } }
  | { type: 'PLAY_ALERT'; payload?: { kind?: 'all-complete' | 'drop-complete'; message?: string } }
  | { type: 'OPEN_STREAMER'; payload?: { streamer?: TwitchStreamer; game?: TwitchGame } };

type BasicResponse = { success: boolean; error?: string };
export type RuntimeResponseByType = BooleanToggleResponseByType &
  MinimalResponseByType & {
    GET_TWITCH_SESSION: BasicResponse & { session?: TwitchSession | null };
    GET_STREAM_CONTEXT: BasicResponse & { context?: unknown };
    PREPARE_STREAM_PLAYBACK: { success: boolean } & PlaybackPrepResult;
    CLAIM_CHANNEL_POINTS_BONUS: BasicResponse & { claimed?: boolean; reason?: string };
    CHANNEL_POINTS_BONUS_CLAIMED: BasicResponse;
    OPEN_MONITOR_DASHBOARD: BasicResponse & { monitorWindowId?: number | null };
    SET_TELEGRAM_CREDENTIALS: BasicResponse & { configured?: boolean; chatId?: string | null };
    GET_TELEGRAM_SETTINGS: BasicResponse & { configured?: boolean; chatId?: string | null };
    SET_STREAMER_SELECTION_MODE: BasicResponse & { streamerSelectionMode?: StreamerSelectionMode };
    SET_PREFERRED_STREAMER_LANGUAGE: BasicResponse & { preferredStreamerLanguage?: string | null };
    SET_GAME_FAVORITE: BasicResponse & { favorite?: boolean; removedQueueEntries?: number };
    SET_GAME_PREFERENCE: BasicResponse & {
      preference?: GamePreference;
      removedQueueEntries?: number;
      retainedQueueEntries?: number;
    };
    SET_CAMPAIGN_PRIORITY_MODE: BasicResponse & { campaignPriorityMode?: CampaignPriorityMode };
    SET_FARM_CATEGORY_SCOPE: BasicResponse & { farmCategoryScope?: FarmCategoryScope };
    SET_WATCH_TRANSPORT_MODE: BasicResponse & { watchTransportPreference?: WatchTransportMode };
    EVALUATE_AUTO_START: BasicResponse & { started?: boolean; reason?: string };
    ADD_TO_QUEUE: BasicResponse & { added?: boolean; reason?: AddToQueueReason };
    REMOVE_FROM_QUEUE: BasicResponse & { removed?: number; queueLength?: number };
    REORDER_QUEUE: BasicResponse & { reordered?: boolean };
    START_FARMING: BasicResponse;
    SET_SELECTED_GAME: BasicResponse & { selectedGame?: TwitchGame | null };
    UPDATE_STATE: BasicResponse;
    ACTIVATE_POPUP: BasicResponse & { result?: ActivationSyncResult; appState?: AppState };
    OPEN_DROPS_AND_SYNC: BasicResponse & { result?: ActivationSyncResult; appState?: AppState };
    ENSURE_GAMES_CACHE: BasicResponse & { refreshed?: boolean; gamesCount?: number; games?: TwitchGame[] };
    OPEN_DROPS_PAGE_AND_REFRESH: BasicResponse & {
      opened?: boolean;
      refreshed?: boolean;
      gamesCount?: number;
      appState?: AppState;
    };
    MARK_DROPS_REFRESH_NOTICE_SEEN: BasicResponse & { seenAt?: number | null };
    UPDATE_GAMES: BasicResponse;
    SYNC_TWITCH_SESSION: BasicResponse;
    SYNC_TWITCH_INTEGRITY: BasicResponse;
    PLAY_ALERT: BasicResponse;
    OPEN_STREAMER: BasicResponse;
    GET_CLAIM_LOG: BasicResponse & { entries?: ClaimLogEntry[] };
    CLEAR_CLAIM_LOG: BasicResponse;
  };
