import { describe, expect, test } from 'bun:test';
import { handleAddToQueue } from '../../src/background/drops-tick.ts';
import {
  createRuntimeMessageListener,
  type RuntimeMessageHandlers,
} from '../../src/background/message-router.ts';
import { resolveGameFromState } from '../../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame } from '../../src/types/index.ts';

function createHandlers(overrides: Partial<RuntimeMessageHandlers> = {}): RuntimeMessageHandlers {
  const missing = () => {
    throw new Error('unexpected handler');
  };

  return {
    ensureGamesCache: missing,
    openDropsPageAndRefresh: missing,
    markDropsRefreshNoticeSeen: missing,
    addToQueue: missing,
    removeFromQueue: missing,
    reorderQueue: missing,
    clearQueue: missing,
    startFarming: missing,
    setSelectedGame: missing,
    pauseFarming: missing,
    setAutoResumeOnStartup: missing,
    resumeFarming: missing,
    stopFarming: missing,
    updateGames: missing,
    syncTwitchSession: missing,
    syncTwitchIntegrity: missing,
    refreshDrops: missing,
    setMonitorAutoOpen: missing,
    setMuteFarmingTab: missing,
    setNotificationsEnabled: missing,
    setTelegramAlertsEnabled: missing,
    setTelegramSystemAlertsEnabled: missing,
    setTelegramCredentials: missing,
    testTelegramAlerts: missing,
    getTelegramSettings: missing,
    setAutoClaimChannelPointsBonus: missing,
    channelPointsBonusClaimed: missing,
    setAutoClaimDrops: missing,
    setStreamerSelectionMode: missing,
    setPreferredStreamerLanguage: missing,
    setGameFavorite: missing,
    setCampaignPriorityMode: missing,
    setFarmCategoryScope: missing,
    setAutoStartFavorites: missing,
    evaluateAutoStart: missing,
    openMonitorDashboard: missing,
    getClaimLog: missing,
    clearClaimLog: missing,
    ...overrides,
  };
}

async function callListener(
  listener: ReturnType<typeof createRuntimeMessageListener>,
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
) {
  let resolveResponse: (value: unknown) => void = () => undefined;
  const responsePromise = new Promise<unknown>((resolve) => {
    resolveResponse = resolve;
  });
  const keepChannelOpen = listener(message, sender, (value?: unknown) => resolveResponse(value));
  const response = await responsePromise;
  return { keepChannelOpen, response };
}

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Game One',
    imageUrl: 'https://example.test/game.png',
    dropCount: 1,
    ...overrides,
  };
}

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Drop One',
    gameId: 'game-1',
    gameName: 'Game One',
    imageUrl: 'https://example.test/drop.png',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

function createAddToQueueListener(
  state: ReturnType<typeof createServiceWorkerState>,
  events: string[],
  evaluateDropsForGame: () => { allDrops: TwitchDrop[]; hasFarmableDrops: boolean },
) {
  return createRuntimeMessageListener(
    createHandlers({
      addToQueue: async (message) =>
        handleAddToQueue(
          state,
          message.payload,
          {
            onTrackActivity: async () => {
              events.push('activity');
            },
            onSaveState: async () => {
              events.push('persist');
              events.push('broadcast');
            },
          },
          {
            resolveGameFromState,
            evaluateDropsForGame,
            getGameDisplayLabel: (game) => game.name,
          },
        ),
    }),
  );
}

function _createUnavailableCampaignState() {
  const state = createServiceWorkerState();
  const existingGame = createGame({ id: 'existing-game', campaignId: 'campaign-existing' });
  const requestedCampaign = createGame({
    id: 'shared-game-id',
    name: 'Shared Game',
    campaignId: 'campaign-missing',
  });
  const siblingCampaign = createGame({
    id: 'canonical-game-id',
    name: 'Shared Game',
    campaignId: 'campaign-sibling',
  });
  state.appState.availableGames = [siblingCampaign];
  state.appState.queue = [existingGame];
  state.appState.selectedGame = existingGame;
  return { state, requestedCampaign, existingGame };
}

describe('runtime message router', () => {
  test('queues a fresh zero-percent Twitch-native reward and persists then broadcasts once', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-fresh-native',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [game];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [createDrop({ campaignId: game.campaignId, rewardKind: 'twitch-badge' })],
      hasFarmableDrops: false,
    }));

    const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

    expect(result.response).toEqual({ success: true, added: true, game, queueLength: 1 });
    expect(state.appState.queue).toEqual([game]);
    expect(events).toEqual(['activity', 'persist', 'broadcast']);
  });

  test('keeps duplicate campaigns distinct while preserving already-queued identity', async () => {
    const state = createServiceWorkerState();
    const campaignA = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const campaignB = createGame({
      campaignId: 'campaign-b',
      campaignName: 'Second campaign',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [campaignA, campaignB];
    state.appState.queue = [campaignA];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const second = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: campaignB },
    });
    const duplicate = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: campaignA },
    });

    expect(second.response).toEqual({ success: true, added: true, game: campaignB, queueLength: 2 });
    expect(duplicate.response).toEqual({
      success: true,
      added: false,
      reason: 'already-queued',
      game: campaignA,
    });
    expect(state.appState.queue).toEqual([campaignA, campaignB]);
    expect(events).toEqual(['activity', 'persist', 'broadcast', 'activity']);
  });
});
