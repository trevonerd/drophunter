import { describe, expect, test } from 'bun:test';
import { handleAddToQueue, handleSetSelectedGame } from '../src/background/drops-tick.ts';
import {
  createRuntimeMessageListener,
  type RuntimeMessageHandlers,
} from '../src/background/message-router.ts';
import { removeGameFromQueue, resolveGameFromState } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStartFarming } from '../src/background/session-lifecycle.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

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

function createUnavailableCampaignState() {
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
  test('waits for initialization before dispatching a valid message', async () => {
    let releaseInitialization: () => void = () => undefined;
    const initialization = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    let handlerCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        syncTwitchIntegrity: async () => {
          handlerCalled = true;
          return { success: true };
        },
      }),
      { beforeHandle: () => initialization },
    );

    const response = callListener(
      listener,
      { type: 'SYNC_TWITCH_INTEGRITY', payload: { token: 'fresh-integrity-token' } },
      { tab: { url: 'https://www.twitch.tv/drops/campaigns' } },
    );
    await Promise.resolve();

    expect(handlerCalled).toBe(false);
    releaseInitialization();
    expect((await response).response).toEqual({ success: true });
    expect(handlerCalled).toBe(true);
  });

  test('does not dispatch a valid message when initialization fails', async () => {
    let handlerCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        setMonitorAutoOpen: async () => {
          handlerCalled = true;
          return { success: true };
        },
      }),
      {
        beforeHandle: async () => {
          throw new Error('storage migration failed');
        },
      },
    );

    const result = await callListener(listener, {
      type: 'SET_MONITOR_AUTO_OPEN',
      payload: { enabled: false },
    });

    expect(handlerCalled).toBe(false);
    expect(result.response).toEqual({ success: false, error: 'Error: storage migration failed' });
  });

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

  test('dispatches REORDER_QUEUE to the reorder handler', async () => {
    let reorderCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        reorderQueue: async (message) => {
          reorderCalled = true;
          expect(message.payload).toEqual({ fromIndex: 1, toIndex: 0 });
          return { success: true, reordered: true };
        },
      }),
    );

    const result = await callListener(listener, {
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 1, toIndex: 0 },
    });

    expect(reorderCalled).toBe(true);
    expect(result.response).toEqual({ success: true, reordered: true });
  });

  test('rejects malformed REORDER_QUEUE payloads before invoking handlers', async () => {
    let reorderCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        reorderQueue: async () => {
          reorderCalled = true;
          return { success: true };
        },
      }),
    );

    const result = await callListener(listener, {
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 0, toIndex: 0 },
    });

    expect(result.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(reorderCalled).toBe(false);
  });

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

    expect(settings.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(test.response).toEqual({ success: true });
    expect(credentials.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(enabled.response).toEqual({ success: true, telegramAlertsEnabled: true });
  });

  test('returns async handler results and converts thrown errors into response errors', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        pauseFarming: async () => ({ success: true, paused: true }),
        resumeFarming: async () => {
          throw new Error('resume failed');
        },
      }),
    );

    const pause = await callListener(listener, { type: 'PAUSE_FARMING' });
    const resume = await callListener(listener, { type: 'RESUME_FARMING' });

    expect(pause.response).toEqual({ success: true, paused: true });
    expect(resume.response).toEqual({ success: false, error: 'Error: resume failed' });
  });

  test('rejects malformed ADD_TO_QUEUE payloads before invoking the handler', async () => {
    let addCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        addToQueue: async () => {
          addCalled = true;
          return { success: true, added: true };
        },
      }),
    );

    const payloads: readonly unknown[] = [
      null,
      {},
      { game: null },
      { game: { id: '', name: 'Game One', imageUrl: 'https://example.test/game.png' } },
      { game: { id: 'game-1', name: 'Game One', imageUrl: 42 } },
      { game: { id: 'game-1', name: 'Game One', imageUrl: 'https://example.test/game.png', campaignId: 42 } },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'farming-complete', remainderReasons: ['invalid'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'all-acquired', remainderReasons: ['subscription-required'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'farmable', remainderReasons: ['unverifiable-twitch'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: {
            completion: 'farming-complete',
            remainderReasons: ['unverifiable-twitch', 'subscription-required'],
          },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: {
            completion: 'farming-complete',
            remainderReasons: ['subscription-required', 'subscription-required'],
          },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          campaignId: '   ',
        },
      },
    ];

    for (const payload of payloads) {
      const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload });
      expect(result.response).toEqual({ success: false, error: 'Invalid message payload' });
    }
    expect(addCalled).toBe(false);
  });

  test('returns farming-complete for subscription-only rewards without mutating or saving', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-subscription',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    state.appState.availableGames = [game];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

    expect(result.response).toEqual({
      success: true,
      added: false,
      reason: 'farming-complete',
      game,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });

  test('rejects a stale explicit campaign instead of rebinding to a sibling game id', async () => {
    const state = createServiceWorkerState();
    const authoritativeSibling = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const staleRequest = createGame({
      campaignId: 'campaign-b',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [authoritativeSibling];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: staleRequest },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });

  test('keeps legacy game-id fallback only when the request has no campaign id', async () => {
    const state = createServiceWorkerState();
    const canonicalGame = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const legacyRequest = createGame({
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [canonicalGame];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: legacyRequest },
    });

    expect(result.response).toEqual({
      success: true,
      added: false,
      reason: 'farming-complete',
      game: canonicalGame,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });

  test('returns farming-complete for unverifiable and combined remainders', async () => {
    const cases = [
      ['campaign-native', ['unverifiable-twitch']],
      ['campaign-combined', ['subscription-required', 'unverifiable-twitch']],
    ] as const;

    for (const [campaignId, remainderReasons] of cases) {
      const state = createServiceWorkerState();
      const game = createGame({
        campaignId,
        rewardSummary: { completion: 'farming-complete', remainderReasons },
      });
      state.appState.availableGames = [game];
      const events: string[] = [];
      const listener = createAddToQueueListener(state, events, () => ({
        allDrops: [],
        hasFarmableDrops: true,
      }));

      const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

      expect(result.response).toEqual({
        success: true,
        added: false,
        reason: 'farming-complete',
        game,
      });
      expect(state.appState.queue).toEqual([]);
      expect(events).toEqual(['activity']);
    }
  });

  test('keeps already-completed exclusive to all-acquired campaigns', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-acquired',
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    });
    state.appState.availableGames = [game];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

    expect(result.response).toEqual({
      success: true,
      added: false,
      reason: 'already-completed',
      game,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });

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

  test('rejects stale explicit START_FARMING campaigns without mutating runtime state', async () => {
    const { state, requestedCampaign, existingGame } = createUnavailableCampaignState();
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async (message) => handleStartFarming(state, message.payload),
      }),
    );
    const queueBefore = [...state.appState.queue];

    const result = await callListener(listener, {
      type: 'START_FARMING',
      payload: { game: requestedCampaign },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual(queueBefore);
    expect(state.appState.selectedGame).toBe(existingGame);
    expect(state.appState.isRunning).toBe(false);
  });

  test('rejects stale explicit SET_SELECTED_GAME campaigns without mutating runtime state', async () => {
    const { state, requestedCampaign, existingGame } = createUnavailableCampaignState();
    const listener = createRuntimeMessageListener(
      createHandlers({
        setSelectedGame: async (message) =>
          handleSetSelectedGame(
            state,
            message.payload,
            {
              onTrackActivity: async () => undefined,
              onEnsureWorkspace: async () => undefined,
              onRefreshDropsData: async () => undefined,
              onOpenBestStreamer: async () => true,
              onSaveState: async () => undefined,
              onSaveTimingState: async () => undefined,
            },
            {
              resolveGameFromState,
              removeGameFromQueue,
              splitDropsForSelectedGame: () => undefined,
              getGameDisplayLabel: (game) => game.name,
              logDebug: () => undefined,
              logWarn: () => undefined,
            },
          ),
      }),
    );
    const queueBefore = [...state.appState.queue];

    const result = await callListener(listener, {
      type: 'SET_SELECTED_GAME',
      payload: { game: requestedCampaign },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual(queueBefore);
    expect(state.appState.selectedGame).toBe(existingGame);
  });
});
