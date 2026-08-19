import {
  favoriteGameIdentityKeys,
  hiddenGameIdentityKeys,
  isFavoriteGame,
  isHiddenGame,
} from '../shared/game-selection.ts';
import type { GamePreference, TwitchGame, WatchTransportMode } from '../types/index.ts';
import type { FarmingAutomation, FarmingAutomationOutcome } from './farming-automation.ts';
import { setGamePreference } from './favorite-games.ts';
import type { createNotificationController } from './notifications.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { saveState } from './state-persistence.ts';

type BrowserEvents = Pick<ReturnType<typeof createServiceWorkerBrowserEvents>, 'watchTransport'>;
type NotificationController = Pick<
  ReturnType<typeof createNotificationController>,
  'setNotificationsEnabled'
>;
type StateLifecycle = Pick<ReturnType<typeof createServiceWorkerStateLifecycle>, 'trackActivity'>;

export interface ServiceWorkerAutomationSettingsDependencies {
  readonly automation: FarmingAutomation;
  readonly browserEvents: BrowserEvents;
  readonly notificationController: NotificationController;
  readonly stateLifecycle: StateLifecycle;
}

function mapExplicitAutomationOutcome(outcome: FarmingAutomationOutcome) {
  switch (outcome.kind) {
    case 'started':
      return { success: true, started: true, reason: 'Campaign started automatically.' } as const;
    case 'unchanged':
      return { success: true, started: false, reason: outcome.reason } as const;
    case 'failed':
      return { success: false, started: false, error: outcome.reason } as const;
    default:
      return outcome satisfies never;
  }
}

export function createServiceWorkerAutomationSettingsHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerAutomationSettingsDependencies,
) {
  const trackActivity = dependencies.stateLifecycle.trackActivity;

  async function handleSetGameFavorite(payload: { readonly game: TwitchGame; readonly favorite: boolean }) {
    const result = await handleSetGamePreference({
      game: payload.game,
      preference: payload.favorite ? 'favorite' : 'normal',
    });
    return {
      success: result.success,
      favorite: result.preference === 'favorite',
      removedQueueEntries: result.removedQueueEntries,
    };
  }

  async function handleSetGamePreference(payload: {
    readonly game: TwitchGame;
    readonly preference: GamePreference;
  }) {
    await trackActivity('set-game-favorite');
    const result = setGamePreference(state.appState, payload.game, payload.preference, Date.now());
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return {
      success: true,
      preference: isHiddenGame(payload.game, hiddenGameIdentityKeys(state.appState.hiddenGames))
        ? 'hidden'
        : isFavoriteGame(payload.game, favoriteGameIdentityKeys(state.appState.favoriteGames))
          ? 'favorite'
          : 'normal',
      removedQueueEntries: result.removedQueueEntries,
      retainedQueueEntries: result.retainedQueueEntries,
    };
  }

  async function handleSetCampaignPriorityMode(payload: {
    readonly mode: 'ending-soonest' | 'lowest-availability' | 'priority-list-only';
  }) {
    await trackActivity('set-campaign-priority-mode');
    state.appState.campaignPriorityMode = payload.mode;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return { success: true, campaignPriorityMode: state.appState.campaignPriorityMode };
  }

  async function handleSetFarmCategoryScope(payload: { readonly scope: 'all' | 'favorites-only' }) {
    await trackActivity('set-farm-category-scope');
    state.appState.farmCategoryScope = payload.scope;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return { success: true, farmCategoryScope: state.appState.farmCategoryScope };
  }

  async function handleSetAutoStartFavorites(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-auto-start-favorites');
    if (payload?.enabled !== true) {
      state.appState.autoStartFavoriteGames = false;
      await saveState(state);
      await dependencies.automation.request('campaign-refresh');
      return { success: true, autoStartFavoriteGames: false };
    }
    const result = await dependencies.notificationController.setNotificationsEnabled(true);
    state.appState.autoStartFavoriteGames = result.success;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return {
      success: result.success,
      autoStartFavoriteGames: state.appState.autoStartFavoriteGames,
      error: result.error,
    };
  }

  async function handleSetWatchTransportMode(payload: { readonly mode: WatchTransportMode }) {
    await trackActivity('set-watch-transport-mode');
    const transport = dependencies.browserEvents.watchTransport;
    const currentStreamer = state.appState.activeStreamer;
    if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) await transport.stop();
    await transport.setPreference(payload.mode);
    if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) {
      await transport.start(currentStreamer);
    }
    return { success: true, watchTransportPreference: state.appState.watchTransportPreference };
  }

  return {
    handleEvaluateAutoStart: async () =>
      mapExplicitAutomationOutcome(await dependencies.automation.request('user-request')),
    handleSetAutoStartFavorites,
    handleSetCampaignPriorityMode,
    handleSetFarmCategoryScope,
    handleSetGameFavorite,
    handleSetGamePreference,
    handleSetWatchTransportMode,
  };
}
