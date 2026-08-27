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

function _createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
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

function _createAddToQueueListener(
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
  test('rejects unknown messages without invoking handlers', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'NOT_A_REAL_MESSAGE' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('rejects critical messages with malformed payloads before invoking handlers', async () => {
    let startCalled = false;
    let syncCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async () => {
          startCalled = true;
          return { success: true };
        },
        syncTwitchIntegrity: async () => {
          syncCalled = true;
          return { success: true };
        },
      }),
    );

    const start = await callListener(listener, { type: 'START_FARMING', payload: { game: null } });
    const integrity = await callListener(listener, {
      type: 'SYNC_TWITCH_INTEGRITY',
      payload: { token: 123 },
    });

    expect(start.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(integrity.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(startCalled).toBe(false);
    expect(syncCalled).toBe(false);
  });

  test('rejects messages that are not handled by the background service worker', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'GET_STREAM_CONTEXT' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unsupported message target' });
  });
});
