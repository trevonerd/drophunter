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
  setTelegramCredentials: RuntimeMessageHandler<'SET_TELEGRAM_CREDENTIALS'>;
  testTelegramAlerts: RuntimeMessageHandler<'TEST_TELEGRAM_ALERTS'>;
  getTelegramSettings: RuntimeMessageHandler<'GET_TELEGRAM_SETTINGS'>;
  setAutoClaimChannelPointsBonus: RuntimeMessageHandler<'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS'>;
  channelPointsBonusClaimed: RuntimeMessageHandler<'CHANNEL_POINTS_BONUS_CLAIMED'>;
  setAutoClaimDrops: RuntimeMessageHandler<'SET_AUTO_CLAIM_DROPS'>;
  setStreamerSelectionMode: RuntimeMessageHandler<'SET_STREAMER_SELECTION_MODE'>;
  setPreferredStreamerLanguage: RuntimeMessageHandler<'SET_PREFERRED_STREAMER_LANGUAGE'>;
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

export function createRuntimeMessageListener(handlers: RuntimeMessageHandlers): RuntimeMessageListener {
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
        return respondAsync(() => handlers.ensureGamesCache(message, sender), sendResponse);
      case 'OPEN_DROPS_PAGE_AND_REFRESH':
        return respondAsync(() => handlers.openDropsPageAndRefresh(message, sender), sendResponse);
      case 'MARK_DROPS_REFRESH_NOTICE_SEEN':
        return respondAsync(() => handlers.markDropsRefreshNoticeSeen(message, sender), sendResponse);
      case 'ADD_TO_QUEUE':
        return respondAsync(() => handlers.addToQueue(message, sender), sendResponse);
      case 'REMOVE_FROM_QUEUE':
        return respondAsync(() => handlers.removeFromQueue(message, sender), sendResponse);
      case 'REORDER_QUEUE':
        return respondAsync(() => handlers.reorderQueue(message, sender), sendResponse);
      case 'CLEAR_QUEUE':
        return respondAsync(() => handlers.clearQueue(message, sender), sendResponse);
      case 'START_FARMING':
        return respondAsync(() => handlers.startFarming(message, sender), sendResponse);
      case 'SET_SELECTED_GAME':
        return respondAsync(() => handlers.setSelectedGame(message, sender), sendResponse);
      case 'PAUSE_FARMING':
        return respondAsync(() => handlers.pauseFarming(message, sender), sendResponse);
      case 'SET_AUTO_RESUME_ON_STARTUP':
        return respondAsync(() => handlers.setAutoResumeOnStartup(message, sender), sendResponse);
      case 'RESUME_FARMING':
        return respondAsync(() => handlers.resumeFarming(message, sender), sendResponse);
      case 'STOP_FARMING':
        return respondAsync(() => handlers.stopFarming(message, sender), sendResponse);
      case 'UPDATE_GAMES':
        return respondAsync(() => handlers.updateGames(message, sender), sendResponse);
      case 'SYNC_TWITCH_SESSION':
        return respondAsync(() => handlers.syncTwitchSession(message, sender), sendResponse);
      case 'SYNC_TWITCH_INTEGRITY':
        return respondAsync(() => handlers.syncTwitchIntegrity(message, sender), sendResponse);
      case 'REFRESH_DROPS':
        return respondAsync(() => handlers.refreshDrops(message, sender), sendResponse);
      case 'SET_MONITOR_AUTO_OPEN':
        return respondAsync(() => handlers.setMonitorAutoOpen(message, sender), sendResponse);
      case 'SET_MUTE_FARMING_TAB':
        return respondAsync(() => handlers.setMuteFarmingTab(message, sender), sendResponse);
      case 'SET_NOTIFICATIONS_ENABLED':
        return respondAsync(() => handlers.setNotificationsEnabled(message, sender), sendResponse);
      case 'SET_TELEGRAM_ALERTS_ENABLED':
        return respondAsync(() => handlers.setTelegramAlertsEnabled(message, sender), sendResponse);
      case 'SET_TELEGRAM_CREDENTIALS':
        return respondAsync(() => handlers.setTelegramCredentials(message, sender), sendResponse);
      case 'TEST_TELEGRAM_ALERTS':
        return respondAsync(() => handlers.testTelegramAlerts(message, sender), sendResponse);
      case 'GET_TELEGRAM_SETTINGS':
        return respondAsync(() => handlers.getTelegramSettings(message, sender), sendResponse);
      case 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS':
        return respondAsync(() => handlers.setAutoClaimChannelPointsBonus(message, sender), sendResponse);
      case 'CHANNEL_POINTS_BONUS_CLAIMED':
        return respondAsync(() => handlers.channelPointsBonusClaimed(message, sender), sendResponse);
      case 'SET_AUTO_CLAIM_DROPS':
        return respondAsync(() => handlers.setAutoClaimDrops(message, sender), sendResponse);
      case 'SET_STREAMER_SELECTION_MODE':
        return respondAsync(() => handlers.setStreamerSelectionMode(message, sender), sendResponse);
      case 'SET_PREFERRED_STREAMER_LANGUAGE':
        return respondAsync(() => handlers.setPreferredStreamerLanguage(message, sender), sendResponse);
      case 'OPEN_MONITOR_DASHBOARD':
        return respondAsync(() => handlers.openMonitorDashboard(message, sender), sendResponse);
      case 'GET_CLAIM_LOG':
        return respondAsync(() => handlers.getClaimLog(message, sender), sendResponse);
      case 'CLEAR_CLAIM_LOG':
        return respondAsync(() => handlers.clearClaimLog(message, sender), sendResponse);

      default:
        assertNever(message);
    }
  };
}

export function registerRuntimeMessageRouter(handlers: RuntimeMessageHandlers) {
  browser.runtime.onMessage.addListener(createRuntimeMessageListener(handlers));
}
