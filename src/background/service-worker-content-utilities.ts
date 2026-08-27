import { browser } from '../shared/browser-api.ts';
import { replaceAvailableGames } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import {
  attemptAutoClaimChannelPointsBonusExt,
  recordChannelPointsBonusClaimedExt,
} from './channel-points.ts';
import { annotateGameCompletion, normalizeGameSelection } from './drops-projection.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import { normalizeQueueSelection } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { saveState, saveTimingState } from './state-persistence.ts';

interface ContentUtilityDependencies {
  automation: FarmingAutomation;
  notify: (title: string, message: string, priority?: number) => Promise<void>;
  awaitInitialization: () => Promise<void>;
  ensureContentScriptOnTab: (tabId: number) => Promise<unknown>;
}

export function createServiceWorkerContentUtilities(
  state: ServiceWorkerState,
  dependencies: ContentUtilityDependencies,
) {
  async function recordChannelPointsBonusClaimed(channelName?: string | null): Promise<void> {
    await recordChannelPointsBonusClaimedExt(
      state.appState,
      {
        saveState: () => saveState(state),
        notify: dependencies.notify,
        awaitInit: dependencies.awaitInitialization,
      },
      channelName,
    );
  }

  async function attemptAutoClaimChannelPointsBonus() {
    return attemptAutoClaimChannelPointsBonusExt(state.appState, {
      ensureContentScriptOnTab: dependencies.ensureContentScriptOnTab,
      sendMessageToTab: (tabId: number, message: unknown) =>
        browser.tabs.sendMessage(tabId, message).catch(() => null),
      getTab: (tabId: number) => browser.tabs.get(tabId).catch(() => null),
      recordBonusClaimed: recordChannelPointsBonusClaimed,
    });
  }

  async function handleUpdateGames(payload?: TwitchGame[]) {
    state.appState.availableGames = replaceAvailableGames(payload ?? []);
    state.appState.availableGames = annotateGameCompletion(
      state.appState.availableGames,
      state.cachedDropsSnapshot,
    );
    if (state.appState.availableGames.length > 0) state.appState.lastSuccessfulRefreshAt = Date.now();
    normalizeGameSelection(state, state.appState.availableGames, true);
    normalizeQueueSelection(state, state.appState.availableGames, true);
    await saveState(state);
    saveTimingState(state).catch(() => undefined);
    await dependencies.automation.request('campaign-refresh');
    return { success: true };
  }

  return {
    attemptAutoClaimChannelPointsBonus,
    handleUpdateGames,
    recordChannelPointsBonusClaimed,
  };
}
