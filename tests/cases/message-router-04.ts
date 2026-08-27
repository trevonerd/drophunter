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
  test('dispatches GET_CLAIM_LOG and CLEAR_CLAIM_LOG to the correct handlers', async () => {
    const fakeEntries = [
      {
        id: 'e1',
        dropId: 'd1',
        dropName: 'Drop',
        gameId: 'g1',
        gameName: 'Game',
        campaignLabel: 'Game',
        claimedAt: 1000,
      },
    ];
    const listener = createRuntimeMessageListener(
      createHandlers({
        getClaimLog: async () => ({ success: true, entries: fakeEntries }),
        clearClaimLog: async () => ({ success: true }),
      }),
    );

    const get = await callListener(listener, { type: 'GET_CLAIM_LOG' });
    const clear = await callListener(listener, { type: 'CLEAR_CLAIM_LOG' });

    expect(get.response).toEqual({ success: true, entries: fakeEntries });
    expect(clear.response).toEqual({ success: true });
  });

  test('dispatches Telegram settings messages to the correct handlers', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        getTelegramSettings: async () => ({ success: true, configured: true, chatId: '123' }),
        testTelegramAlerts: async () => ({ success: true }),
        setTelegramCredentials: async () => ({ success: true, configured: true, chatId: '123' }),
        setTelegramAlertsEnabled: async () => ({ success: true, telegramAlertsEnabled: true }),
        setTelegramSystemAlertsEnabled: async () => ({ success: true, telegramSystemAlertsEnabled: true }),
      }),
    );

    const settings = await callListener(listener, { type: 'GET_TELEGRAM_SETTINGS' });
    const test = await callListener(listener, { type: 'TEST_TELEGRAM_ALERTS' });
    const credentials = await callListener(listener, {
      type: 'SET_TELEGRAM_CREDENTIALS',
      payload: { botToken: '123:abc', chatId: '123' },
    });
    const enabled = await callListener(listener, {
      type: 'SET_TELEGRAM_ALERTS_ENABLED',
      payload: { enabled: true },
    });
    const systemEnabled = await callListener(listener, {
      type: 'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED',
      payload: { enabled: true },
    });

    expect(settings.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(test.response).toEqual({ success: true });
    expect(credentials.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(enabled.response).toEqual({ success: true, telegramAlertsEnabled: true });
    expect(systemEnabled.response).toEqual({ success: true, telegramSystemAlertsEnabled: true });
  });
});
