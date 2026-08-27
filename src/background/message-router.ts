import { browser } from '../shared/browser-api.ts';
import {
  assertNever,
  isRuntimeMessageType,
  isRuntimeRequest,
  type RuntimeRequest,
  type RuntimeResponseByType,
} from '../shared/messages.ts';

type MaybePromise<T> = T | Promise<T>;
type RuntimeSender = chrome.runtime.MessageSender;
type RuntimeSendResponse = (response?: unknown) => void;
type RuntimeMessageListener = (
  message: unknown,
  sender: RuntimeSender,
  sendResponse: RuntimeSendResponse,
) => boolean | undefined;

type RuntimeMessageHandler<T extends RuntimeRequest['type']> = (
  message: Extract<RuntimeRequest, { type: T }>,
  sender: RuntimeSender,
) => MaybePromise<unknown>;

type AddToQueueRuntimeMessageHandler = (
  message: Extract<RuntimeRequest, { type: 'ADD_TO_QUEUE' }>,
  sender: RuntimeSender,
) => MaybePromise<RuntimeResponseByType['ADD_TO_QUEUE']>;

export interface RuntimeMessageHandlers {
  activatePopup: RuntimeMessageHandler<'ACTIVATE_POPUP'>;
  openDropsAndSync: RuntimeMessageHandler<'OPEN_DROPS_AND_SYNC'>;
  ensureGamesCache: RuntimeMessageHandler<'ENSURE_GAMES_CACHE'>;
  openDropsPageAndRefresh: RuntimeMessageHandler<'OPEN_DROPS_PAGE_AND_REFRESH'>;
  markDropsRefreshNoticeSeen: RuntimeMessageHandler<'MARK_DROPS_REFRESH_NOTICE_SEEN'>;
  addToQueue: AddToQueueRuntimeMessageHandler;
  removeFromQueue: RuntimeMessageHandler<'REMOVE_FROM_QUEUE'>;
  reorderQueue: RuntimeMessageHandler<'REORDER_QUEUE'>;
  clearQueue: RuntimeMessageHandler<'CLEAR_QUEUE'>;
  startFarming: RuntimeMessageHandler<'START_FARMING'>;
  setSelectedGame: RuntimeMessageHandler<'SET_SELECTED_GAME'>;
  pauseFarming: RuntimeMessageHandler<'PAUSE_FARMING'>;
  setAutoResumeOnStartup: RuntimeMessageHandler<'SET_AUTO_RESUME_ON_STARTUP'>;
  resumeFarming: RuntimeMessageHandler<'RESUME_FARMING'>;
  stopFarming: RuntimeMessageHandler<'STOP_FARMING'>;
  updateGames: RuntimeMessageHandler<'UPDATE_GAMES'>;
  syncTwitchSession: RuntimeMessageHandler<'SYNC_TWITCH_SESSION'>;
  syncTwitchIntegrity: RuntimeMessageHandler<'SYNC_TWITCH_INTEGRITY'>;
  refreshDrops: RuntimeMessageHandler<'REFRESH_DROPS'>;
  setMonitorAutoOpen: RuntimeMessageHandler<'SET_MONITOR_AUTO_OPEN'>;
  setMuteFarmingTab: RuntimeMessageHandler<'SET_MUTE_FARMING_TAB'>;
  setNotificationsEnabled: RuntimeMessageHandler<'SET_NOTIFICATIONS_ENABLED'>;
  setTelegramAlertsEnabled: RuntimeMessageHandler<'SET_TELEGRAM_ALERTS_ENABLED'>;
  setTelegramSystemAlertsEnabled: RuntimeMessageHandler<'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED'>;
  setTelegramCredentials: RuntimeMessageHandler<'SET_TELEGRAM_CREDENTIALS'>;
  testTelegramAlerts: RuntimeMessageHandler<'TEST_TELEGRAM_ALERTS'>;
  getTelegramSettings: RuntimeMessageHandler<'GET_TELEGRAM_SETTINGS'>;
  setAutoClaimChannelPointsBonus: RuntimeMessageHandler<'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS'>;
  channelPointsBonusClaimed: RuntimeMessageHandler<'CHANNEL_POINTS_BONUS_CLAIMED'>;
  setAutoClaimDrops: RuntimeMessageHandler<'SET_AUTO_CLAIM_DROPS'>;
  setStreamerSelectionMode: RuntimeMessageHandler<'SET_STREAMER_SELECTION_MODE'>;
  setPreferredStreamerLanguage: RuntimeMessageHandler<'SET_PREFERRED_STREAMER_LANGUAGE'>;
  setGameFavorite: RuntimeMessageHandler<'SET_GAME_FAVORITE'>;
  setGamePreference: RuntimeMessageHandler<'SET_GAME_PREFERENCE'>;
  setCampaignPriorityMode: RuntimeMessageHandler<'SET_CAMPAIGN_PRIORITY_MODE'>;
  setFarmCategoryScope: RuntimeMessageHandler<'SET_FARM_CATEGORY_SCOPE'>;
  setAutoStartFavorites: RuntimeMessageHandler<'SET_AUTO_START_FAVORITES'>;
  setWatchTransportMode: RuntimeMessageHandler<'SET_WATCH_TRANSPORT_MODE'>;
  evaluateAutoStart: RuntimeMessageHandler<'EVALUATE_AUTO_START'>;
  openMonitorDashboard: RuntimeMessageHandler<'OPEN_MONITOR_DASHBOARD'>;
  getClaimLog: RuntimeMessageHandler<'GET_CLAIM_LOG'>;
  clearClaimLog: RuntimeMessageHandler<'CLEAR_CLAIM_LOG'>;
}

function respondAsync(handler: () => MaybePromise<unknown>, sendResponse: RuntimeSendResponse) {
  try {
    Promise.resolve(handler())
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
  return true;
}

function unsupportedTarget(sendResponse: RuntimeSendResponse) {
  sendResponse({ success: false, error: 'Unsupported message target' });
  return true;
}

export interface RuntimeMessageListenerOptions {
  beforeHandle?: () => MaybePromise<void>;
}

export function createRuntimeMessageListener(
  handlers: RuntimeMessageHandlers,
  options: RuntimeMessageListenerOptions = {},
): RuntimeMessageListener {
  return (message: unknown, sender, sendResponse) => {
    const type = message && typeof message === 'object' ? (message as { type?: unknown }).type : undefined;
    if (!isRuntimeMessageType(type)) {
      sendResponse({ success: false, error: 'Unknown message type' });
      return true;
    }
    if (!isRuntimeRequest(message)) {
      sendResponse({ success: false, error: 'Invalid message payload' });
      return true;
    }

    const respond = (handler: () => MaybePromise<unknown>) =>
      respondAsync(async () => {
        await options.beforeHandle?.();
        return handler();
      }, sendResponse);

    switch (message.type) {
      case 'GET_TWITCH_SESSION':
      case 'GET_STREAM_CONTEXT':
      case 'PREPARE_STREAM_PLAYBACK':
      case 'CLAIM_CHANNEL_POINTS_BONUS':
      case 'PLAY_ALERT':
      case 'UPDATE_STATE':
      case 'OPEN_STREAMER':
        return unsupportedTarget(sendResponse);

      case 'ENSURE_GAMES_CACHE':
        return respond(() => handlers.ensureGamesCache(message, sender));
      case 'ACTIVATE_POPUP':
        return respond(() => handlers.activatePopup(message, sender));
      case 'OPEN_DROPS_AND_SYNC':
        return respond(() => handlers.openDropsAndSync(message, sender));
      case 'OPEN_DROPS_PAGE_AND_REFRESH':
        return respond(() => handlers.openDropsPageAndRefresh(message, sender));
      case 'MARK_DROPS_REFRESH_NOTICE_SEEN':
        return respond(() => handlers.markDropsRefreshNoticeSeen(message, sender));
      case 'ADD_TO_QUEUE':
        return respond(() => handlers.addToQueue(message, sender));
      case 'REMOVE_FROM_QUEUE':
        return respond(() => handlers.removeFromQueue(message, sender));
      case 'REORDER_QUEUE':
        return respond(() => handlers.reorderQueue(message, sender));
      case 'CLEAR_QUEUE':
        return respond(() => handlers.clearQueue(message, sender));
      case 'START_FARMING':
        return respond(() => handlers.startFarming(message, sender));
      case 'SET_SELECTED_GAME':
        return respond(() => handlers.setSelectedGame(message, sender));
      case 'PAUSE_FARMING':
        return respond(() => handlers.pauseFarming(message, sender));
      case 'SET_AUTO_RESUME_ON_STARTUP':
        return respond(() => handlers.setAutoResumeOnStartup(message, sender));
      case 'RESUME_FARMING':
        return respond(() => handlers.resumeFarming(message, sender));
      case 'STOP_FARMING':
        return respond(() => handlers.stopFarming(message, sender));
      case 'UPDATE_GAMES':
        return respond(() => handlers.updateGames(message, sender));
      case 'SYNC_TWITCH_SESSION':
        return respond(() => handlers.syncTwitchSession(message, sender));
      case 'SYNC_TWITCH_INTEGRITY':
        return respond(() => handlers.syncTwitchIntegrity(message, sender));
      case 'REFRESH_DROPS':
        return respond(() => handlers.refreshDrops(message, sender));
      case 'SET_MONITOR_AUTO_OPEN':
        return respond(() => handlers.setMonitorAutoOpen(message, sender));
      case 'SET_MUTE_FARMING_TAB':
        return respond(() => handlers.setMuteFarmingTab(message, sender));
      case 'SET_NOTIFICATIONS_ENABLED':
        return respond(() => handlers.setNotificationsEnabled(message, sender));
      case 'SET_TELEGRAM_ALERTS_ENABLED':
        return respond(() => handlers.setTelegramAlertsEnabled(message, sender));
      case 'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED':
        return respond(() => handlers.setTelegramSystemAlertsEnabled(message, sender));
      case 'SET_TELEGRAM_CREDENTIALS':
        return respond(() => handlers.setTelegramCredentials(message, sender));
      case 'TEST_TELEGRAM_ALERTS':
        return respond(() => handlers.testTelegramAlerts(message, sender));
      case 'GET_TELEGRAM_SETTINGS':
        return respond(() => handlers.getTelegramSettings(message, sender));
      case 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS':
        return respond(() => handlers.setAutoClaimChannelPointsBonus(message, sender));
      case 'CHANNEL_POINTS_BONUS_CLAIMED':
        return respond(() => handlers.channelPointsBonusClaimed(message, sender));
      case 'SET_AUTO_CLAIM_DROPS':
        return respond(() => handlers.setAutoClaimDrops(message, sender));
      case 'SET_STREAMER_SELECTION_MODE':
        return respond(() => handlers.setStreamerSelectionMode(message, sender));
      case 'SET_PREFERRED_STREAMER_LANGUAGE':
        return respond(() => handlers.setPreferredStreamerLanguage(message, sender));
      case 'SET_GAME_FAVORITE':
        return respond(() => handlers.setGameFavorite(message, sender));
      case 'SET_GAME_PREFERENCE':
        return respond(() => handlers.setGamePreference(message, sender));
      case 'SET_CAMPAIGN_PRIORITY_MODE':
        return respond(() => handlers.setCampaignPriorityMode(message, sender));
      case 'SET_FARM_CATEGORY_SCOPE':
        return respond(() => handlers.setFarmCategoryScope(message, sender));
      case 'SET_AUTO_START_FAVORITES':
        return respond(() => handlers.setAutoStartFavorites(message, sender));
      case 'SET_WATCH_TRANSPORT_MODE':
        return respond(() => handlers.setWatchTransportMode(message, sender));
      case 'EVALUATE_AUTO_START':
        return respond(() => handlers.evaluateAutoStart(message, sender));
      case 'OPEN_MONITOR_DASHBOARD':
        return respond(() => handlers.openMonitorDashboard(message, sender));
      case 'GET_CLAIM_LOG':
        return respond(() => handlers.getClaimLog(message, sender));
      case 'CLEAR_CLAIM_LOG':
        return respond(() => handlers.clearClaimLog(message, sender));

      default:
        assertNever(message);
    }
  };
}

export function registerRuntimeMessageRouter(
  handlers: RuntimeMessageHandlers,
  options: RuntimeMessageListenerOptions = {},
) {
  browser.runtime.onMessage.addListener(createRuntimeMessageListener(handlers, options));
}
