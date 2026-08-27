import type { GamePreference, TwitchGame } from '../types';
import {
  BOOLEAN_TOGGLE_MESSAGES,
  NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES,
  RUNTIME_MESSAGE_TYPES,
  type RuntimeMessageType,
  type RuntimeRequest,
} from './message-contracts.ts';

const runtimeMessageTypeSet = new Set<string>(RUNTIME_MESSAGE_TYPES);

export function isRuntimeMessageType(value: unknown): value is RuntimeMessageType {
  return typeof value === 'string' && runtimeMessageTypeSet.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isGamePreference(value: unknown): value is GamePreference {
  return value === 'normal' || value === 'favorite' || value === 'hidden';
}

function isCampaignRewardSummaryLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const completion = value.completion;
  const reasons = value.remainderReasons;
  if (
    (completion !== 'farmable' && completion !== 'farming-complete' && completion !== 'all-acquired') ||
    !Array.isArray(reasons) ||
    !reasons.every((reason) => reason === 'subscription-required' || reason === 'unverifiable-twitch')
  )
    return false;
  const subscription = reasons.includes('subscription-required');
  const unverifiable = reasons.includes('unverifiable-twitch');
  const canonical =
    reasons.length === 0 ||
    (reasons.length === 1 && (subscription || unverifiable)) ||
    (reasons.length === 2 && reasons[0] === 'subscription-required' && reasons[1] === 'unverifiable-twitch');
  return canonical && (completion === 'farming-complete' || reasons.length === 0);
}

export function validateBooleanTogglePayload(payload: unknown): payload is { enabled?: boolean } {
  return (
    payload === undefined ||
    (isRecord(payload) && (payload.enabled === undefined || typeof payload.enabled === 'boolean'))
  );
}

function isTwitchGameLike(value: unknown): value is TwitchGame {
  if (!isRecord(value)) return false;
  const dropCount = value.dropCount;
  const validDropCount =
    dropCount === undefined ||
    (typeof dropCount === 'number' &&
      Number.isFinite(dropCount) &&
      Number.isInteger(dropCount) &&
      dropCount >= 0);
  const summary = value.rewardSummary;
  const completion = isRecord(summary) ? summary.completion : undefined;
  const consistentCompletion =
    value.allDropsCompleted === undefined ||
    summary === undefined ||
    value.allDropsCompleted === (completion === 'all-acquired');
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.imageUrl === 'string' &&
    (value.campaignId === undefined ||
      (typeof value.campaignId === 'string' && value.campaignId.trim().length > 0)) &&
    validDropCount &&
    (value.allDropsCompleted === undefined || typeof value.allDropsCompleted === 'boolean') &&
    (summary === undefined || isCampaignRewardSummaryLike(summary)) &&
    consistentCompletion
  );
}

function hasGamePayload(value: unknown, allowMissingGame = false): boolean {
  if (!isRecord(value)) return allowMissingGame && value === undefined;
  return value.game === undefined ? allowMissingGame : isTwitchGameLike(value.game);
}

function isValidReorderPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const { fromIndex, toIndex } = payload;
  return (
    typeof fromIndex === 'number' &&
    typeof toIndex === 'number' &&
    Number.isInteger(fromIndex) &&
    Number.isInteger(toIndex) &&
    fromIndex >= 0 &&
    toIndex >= 0 &&
    fromIndex !== toIndex
  );
}

function isValidSettingsPayload(type: RuntimeMessageType, payload: unknown): boolean | undefined {
  switch (type) {
    case 'SET_TELEGRAM_CREDENTIALS':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.botToken === undefined || typeof payload.botToken === 'string') &&
          (payload.chatId === undefined || typeof payload.chatId === 'string') &&
          (payload.clearToken === undefined || typeof payload.clearToken === 'boolean'))
      );
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
    case 'SET_GAME_FAVORITE':
      return isRecord(payload) && isTwitchGameLike(payload.game) && typeof payload.favorite === 'boolean';
    case 'SET_GAME_PREFERENCE':
      return isRecord(payload) && isTwitchGameLike(payload.game) && isGamePreference(payload.preference);
    case 'SET_CAMPAIGN_PRIORITY_MODE':
      return (
        isRecord(payload) &&
        (payload.mode === 'ending-soonest' ||
          payload.mode === 'lowest-availability' ||
          payload.mode === 'priority-list-only')
      );
    case 'SET_FARM_CATEGORY_SCOPE':
      return isRecord(payload) && (payload.scope === 'all' || payload.scope === 'favorites-only');
    case 'SET_WATCH_TRANSPORT_MODE':
      return isRecord(payload) && (payload.mode === 'managed-tab' || payload.mode === 'tabless');
    default:
      return undefined;
  }
}

function isValidOptionalPayload(type: RuntimeMessageType, payload: unknown): boolean | undefined {
  switch (type) {
    case 'CHANNEL_POINTS_BONUS_CLAIMED':
      return (
        payload === undefined ||
        (isRecord(payload) &&
          (payload.channelName === undefined ||
            payload.channelName === null ||
            typeof payload.channelName === 'string'))
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
    case 'MARK_DROPS_REFRESH_NOTICE_SEEN':
      return (
        payload === undefined ||
        (isRecord(payload) && (payload.seenAt === undefined || typeof payload.seenAt === 'number'))
      );
    case 'OPEN_MONITOR_DASHBOARD':
      return (
        payload === undefined ||
        (isRecord(payload) && (payload.toggle === undefined || typeof payload.toggle === 'boolean'))
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
    default:
      return undefined;
  }
}

function isRuntimePayloadValid(type: RuntimeMessageType, payload: unknown): boolean {
  if (type in BOOLEAN_TOGGLE_MESSAGES) return validateBooleanTogglePayload(payload);
  if (type in NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES) return payload === undefined;
  const settingsResult = isValidSettingsPayload(type, payload);
  if (settingsResult !== undefined) return settingsResult;
  const optionalResult = isValidOptionalPayload(type, payload);
  if (optionalResult !== undefined) return optionalResult;
  switch (type) {
    case 'START_FARMING':
      return hasGamePayload(payload, true);
    case 'ADD_TO_QUEUE':
      return hasGamePayload(payload);
    case 'SET_SELECTED_GAME':
      return isRecord(payload) && isTwitchGameLike(payload.game);
    case 'UPDATE_GAMES':
      return payload === undefined || (Array.isArray(payload) && payload.every(isTwitchGameLike));
    case 'SYNC_TWITCH_SESSION':
      return isRecord(payload) && (payload.session === undefined || isRecord(payload.session));
    case 'SYNC_TWITCH_INTEGRITY':
      return (
        isRecord(payload) &&
        typeof payload.token === 'string' &&
        payload.token.trim().length > 0 &&
        (payload.expiration === undefined || typeof payload.expiration === 'number') &&
        (payload.request_id === undefined || typeof payload.request_id === 'string')
      );
    case 'REMOVE_FROM_QUEUE':
      return (
        isRecord(payload) &&
        (payload.game === undefined || isTwitchGameLike(payload.game)) &&
        (payload.gameId === undefined || typeof payload.gameId === 'string') &&
        (payload.campaignId === undefined || typeof payload.campaignId === 'string')
      );
    case 'REORDER_QUEUE':
      return isValidReorderPayload(payload);
    case 'GET_TWITCH_SESSION':
    case 'GET_STREAM_CONTEXT':
    case 'PREPARE_STREAM_PLAYBACK':
    case 'CLAIM_CHANNEL_POINTS_BONUS':
    case 'EVALUATE_AUTO_START':
    case 'ACTIVATE_POPUP':
    case 'OPEN_DROPS_AND_SYNC':
      return payload === undefined;
    case 'UPDATE_STATE':
    case 'GET_CLAIM_LOG':
    case 'CLEAR_CLAIM_LOG':
    case 'GET_TELEGRAM_SETTINGS':
      return true;
    default:
      return false;
  }
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) return false;
  const type = value.type;
  return isRuntimeMessageType(type) && isRuntimePayloadValid(type, value.payload);
}
