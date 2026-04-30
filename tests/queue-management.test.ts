import { beforeEach, describe, expect, test, afterEach } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import {
  normalizeQueueSelection,
  removeGameFromQueue,
  resolveGameFromState,
  pushGameToQueue,
  resetStreamTrackingState,
  applyStopState,
  enterPersistentRecovery,
  stopFarmingSession,
  advanceQueueIfCompleted,
  skipCurrentGameDueToStall,
  handleStartFarming,
  rotateStreamer,
  rotateStreamerIfInvalid,
} from '../src/background/queue-management.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame, TwitchDrop } from '../src/types/index.ts';
import type { StreamRotationReason } from '../src/background/stream-rotation.ts';

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-123',
    name: 'Test Game',
    imageUrl: 'https://example.com/game.png',
    ...overrides,
  };
}

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-123',
    name: 'Test Drop',
    gameId: 'game-123',
    gameName: 'Test Game',
    imageUrl: 'https://example.com/drop.png',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    dropType: 'time-based',
    ...overrides,
  };
}

describe('normalizeQueueSelection', () => {
  test('clears queue if queue is not an array', () => {
    const state = createMinimalState();
    (state.appState.queue as unknown) = null;
    normalizeQueueSelection(state, []);
    expect(state.appState.queue).toEqual([]);
  });

  test('returns early if queue is empty', () => {
    const state = createMinimalState();
    state.appState.queue = [];
    normalizeQueueSelection(state, []);
    expect(state.appState.queue).toEqual([]);
  });

  test('removes expired games from queue', () => {
    const state = createMinimalState();
    const expiredGame = createGame({ id: 'expired', expiresInMs: -1 });
    const validGame = createGame({ id: 'valid', expiresInMs: 3600000 });
    state.appState.queue = [expiredGame, validGame];
    normalizeQueueSelection(state, [validGame]);
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.queue[0].id).toBe('valid');
  });

  test('removes duplicate games from queue', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'duplicate' });
    state.appState.queue = [game, game, game];
    normalizeQueueSelection(state, [game]);
    expect(state.appState.queue).toHaveLength(1);
  });

  test('resolves games using findMatchingGame when available', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1', name: 'Original' });
    const resolvedGame = createGame({ id: 'game-1', name: 'Resolved', campaignId: 'campaign-1' });
    state.appState.queue = [game];
    normalizeQueueSelection(state, [resolvedGame]);
    expect(state.appState.queue[0].id).toBe('game-1');
    expect(state.appState.queue[0].campaignId).toBe('campaign-1');
  });

  test('allows vanished drops to be removed when dropVanished is true', () => {
    const state = createMinimalState();
    const vanishedGame = createGame({ id: 'vanished', campaignId: 'campaign-gone' });
    state.appState.queue = [vanishedGame];
    normalizeQueueSelection(state, [], true);
    expect(state.appState.queue).toHaveLength(0);
  });

  test('keeps vanished games in queue when dropVanished is false', () => {
    const state = createMinimalState();
    const vanishedGame = createGame({ id: 'vanished', campaignId: 'campaign-gone' });
    state.appState.queue = [vanishedGame];
    normalizeQueueSelection(state, [], false);
    expect(state.appState.queue).toHaveLength(1);
  });
});

describe('removeGameFromQueue', () => {
  test('removes matching game from queue', () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1' });
    const game2 = createGame({ id: 'game-2' });
    const game3 = createGame({ id: 'game-3' });
    state.appState.queue = [game1, game2, game3];
    removeGameFromQueue(state, game2);
    expect(state.appState.queue).toHaveLength(2);
    expect(state.appState.queue.map(g => g.id)).toEqual(['game-1', 'game-3']);
  });

  test('removes all matching games from queue', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'duplicate' });
    state.appState.queue = [game, game, game];
    removeGameFromQueue(state, game);
    expect(state.appState.queue).toHaveLength(0);
  });

  test('does nothing if game not in queue', () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1' });
    const game2 = createGame({ id: 'game-2' });
    state.appState.queue = [game1];
    removeGameFromQueue(state, game2);
    expect(state.appState.queue).toHaveLength(1);
  });
});

describe('resolveGameFromState', () => {
  test('returns resolved game when found in availableGames', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1', name: 'Test Game' });
    const resolved = createGame({ id: 'game-1', name: 'Test Game', campaignId: 'campaign-1' });
    state.appState.availableGames = [resolved];
    const result = resolveGameFromState(state, game);
    expect(result.campaignId).toBe('campaign-1');
  });

  test('returns original game when not found in availableGames', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1', name: 'Test Game' });
    state.appState.availableGames = [];
    const result = resolveGameFromState(state, game);
    expect(result.id).toBe('game-1');
  });

  test('falls back to name matching when exact match not found', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'old-id', name: 'Test Game' });
    const nameMatch = createGame({ id: 'new-id', name: 'Test Game', campaignId: 'campaign-1' });
    state.appState.availableGames = [nameMatch];
    const result = resolveGameFromState(state, game);
    expect(result.id).toBe('new-id');
  });

  test('prefers campaigns without campaignId over those with', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'old-id', name: 'Test Game' });
    const withoutCampaign = createGame({ id: 'new-1', name: 'Test Game' });
    const withCampaign = createGame({ id: 'new-2', name: 'Test Game', campaignId: 'campaign-1' });
    state.appState.availableGames = [withCampaign, withoutCampaign];
    const result = resolveGameFromState(state, game);
    expect(result.id).toBe('new-1');
  });
});

describe('pushGameToQueue', () => {
  test('adds game to end of queue', () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1' });
    const game2 = createGame({ id: 'game-2' });
    state.appState.queue = [game1];
    pushGameToQueue(state, game2);
    expect(state.appState.queue).toHaveLength(2);
    expect(state.appState.queue[1].id).toBe('game-2');
  });

  test('does not add duplicate game to queue', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1' });
    state.appState.queue = [game];
    pushGameToQueue(state, createGame({ id: 'game-1' }));
    expect(state.appState.queue).toHaveLength(1);
  });

  test('adds game to empty queue', () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1' });
    pushGameToQueue(state, game);
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.queue[0].id).toBe('game-1');
  });
});

describe('resetStreamTrackingState', () => {
  test('resets all tracking state values', () => {
    const state = createMinimalState({
      invalidStreamChecks: 5,
      lastStreamRotationAt: Date.now(),
      streamValidationGraceUntil: Date.now() + 10000,
      lastTrackedProgress: 50,
      lastTrackedMinutes: 10,
      lastTrackedDropKey: 'drop-123',
      lastProgressAdvanceAt: Date.now(),
      noProgressRotationAttempts: 3,
      playbackAttentionWarningSent: true,
      stalledRecoveryAttempts: 2,
      recoveryBackoffUntil: Date.now() + 10000,
      lastRecoveryAttemptAt: Date.now(),
      recoveryNotificationSent: true,
    });
    state.appState.recoveryReason = 'test-reason';
    state.appState.recoveryBackoffUntil = Date.now();
    state.appState.recoveryAttempts = 3;

    resetStreamTrackingState(state);

    expect(state.invalidStreamChecks).toBe(0);
    expect(state.lastStreamRotationAt).toBe(0);
    expect(state.streamValidationGraceUntil).toBe(0);
    expect(state.lastTrackedProgress).toBe(-1);
    expect(state.lastTrackedMinutes).toBe(-1);
    expect(state.lastTrackedDropKey).toBeNull();
    expect(state.lastProgressAdvanceAt).toBe(0);
    expect(state.noProgressRotationAttempts).toBe(0);
    expect(state.playbackAttentionWarningSent).toBe(false);
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.recoveryBackoffUntil).toBe(0);
    expect(state.lastRecoveryAttemptAt).toBe(0);
    expect(state.recoveryNotificationSent).toBe(false);
  });

  test('clears recovery status from appState', () => {
    const state = createMinimalState();
    state.appState.recoveryReason = 'test';
    state.appState.recoveryBackoffUntil = Date.now();
    state.appState.recoveryAttempts = 3;

    resetStreamTrackingState(state);

    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.recoveryBackoffUntil).toBeNull();
    expect(state.appState.recoveryAttempts).toBeNull();
  });
});

describe('applyStopState', () => {
  test('applies stop state with reason and message', () => {
    const state = createMinimalState();
    applyStopState(state, 'test-reason', 'Test stop message');
    expect(state.appState.lastStopReason).toBe('test-reason');
    expect(state.appState.lastStopMessage).toBe('Test stop message');
  });

  test('applies stop state with null message', () => {
    const state = createMinimalState();
    applyStopState(state, 'test-reason', null);
    expect(state.appState.lastStopReason).toBe('test-reason');
    expect(state.appState.lastStopMessage).toBeNull();
  });

  test('clears recovery state when applying stop', () => {
    const state = createMinimalState({
      stalledRecoveryAttempts: 3,
      recoveryBackoffUntil: Date.now(),
      recoveryNotificationSent: true,
    });
    state.appState.recoveryReason = 'previous-recovery';

    applyStopState(state, 'new-stop', 'message');

    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.recoveryBackoffUntil).toBe(0);
    expect(state.recoveryNotificationSent).toBe(false);
    expect(state.appState.recoveryReason).toBeNull();
  });
});

describe('enterPersistentRecovery', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('increments stalledRecoveryAttempts', async () => {
    const state = createMinimalState({ stalledRecoveryAttempts: 0 });
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
    expect(state.stalledRecoveryAttempts).toBe(1);
  });

  test('calls onSkipCurrentGame when max recovery cycles exceeded', async () => {
    const state = createMinimalState({ stalledRecoveryAttempts: 5 });
    let skipCalled = false;
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message', {
      onSkipCurrentGame: async () => {
        skipCalled = true;
      },
    });
    expect(skipCalled).toBe(true);
    expect(state.stalledRecoveryAttempts).toBe(6);
  });

  test('does not call onSkipCurrentGame if not provided', async () => {
    const state = createMinimalState({ stalledRecoveryAttempts: 6 });
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
    expect(state.stalledRecoveryAttempts).toBe(7);
  });

  test('sets recoveryBackoffUntil based on attempts', async () => {
    const state = createMinimalState({ stalledRecoveryAttempts: 1 });
    const before = Date.now();
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
    expect(state.recoveryBackoffUntil).toBeGreaterThan(before);
    expect(state.lastRecoveryAttemptAt).toBeGreaterThanOrEqual(before);
  });

  test('sets recovery status on appState', async () => {
    const state = createMinimalState();
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
    expect(state.appState.recoveryReason).toBe('stalled-progress');
    expect(state.appState.recoveryBackoffUntil).toBe(state.recoveryBackoffUntil);
    expect(state.appState.recoveryAttempts).toBe(1);
  });

  test('sends notification only on first recovery entry', async () => {
    const state = createMinimalState({ recoveryNotificationSent: false });
    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
    expect(state.recoveryNotificationSent).toBe(true);

    await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
  });
});

describe('stopFarmingSession', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('calls onStopMonitoring callback', async () => {
    const state = createMinimalState();
    let stopMonitoringCalled = false;
    await stopFarmingSession(state, {
      onStopMonitoring: () => {
        stopMonitoringCalled = true;
      },
    });
    expect(stopMonitoringCalled).toBe(true);
  });

  test('resets stream tracking state', async () => {
    const state = createMinimalState({
      invalidStreamChecks: 5,
      noProgressRotationAttempts: 3,
    });
    await stopFarmingSession(state, {});
    expect(state.invalidStreamChecks).toBe(0);
    expect(state.noProgressRotationAttempts).toBe(0);
  });

  test('clears drop claim state', async () => {
    const state = createMinimalState();
    state.dropClaimRetryAtById.set('drop-1', Date.now());
    state.dropClaimInFlight = true;
    await stopFarmingSession(state, {});
    expect(state.dropClaimRetryAtById.size).toBe(0);
    expect(state.dropClaimInFlight).toBe(false);
  });

  test('closes managed tab via callback', async () => {
    const state = createMinimalState();
    state.appState.tabId = 123;
    let closedTabId: number | null = null;
    await stopFarmingSession(state, {
      onCloseManagedTab: async (tabId) => {
        closedTabId = tabId;
      },
    });
    expect(closedTabId).toBe(123);
  });

  test('resets running and paused flags', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.isPaused = true;
    await stopFarmingSession(state, {});
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.isPaused).toBe(false);
  });

  test('clears activeStreamer and tabId', async () => {
    const state = createMinimalState();
    state.appState.activeStreamer = { id: 'streamer-1', name: 'test', displayName: 'Test', isLive: true };
    state.appState.tabId = 123;
    await stopFarmingSession(state, {});
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.tabId).toBeNull();
  });

  test('applies stop state when stopReason provided', async () => {
    const state = createMinimalState();
    let applyStopStateCalled = false;
    await stopFarmingSession(state, {
      stopReason: 'user-stop',
      stopMessage: 'User stopped farming',
      onApplyStopState: () => {
        applyStopStateCalled = true;
      },
    });
    expect(applyStopStateCalled).toBe(true);
  });

  test('sends notification when provided', async () => {
    const state = createMinimalState();
    let notificationTitle = '';
    let notificationMessage = '';
    await stopFarmingSession(state, {
      notification: { title: 'Test Title', message: 'Test Message' },
      onNotify: async (title, message) => {
        notificationTitle = title;
        notificationMessage = message;
      },
    });
    expect(notificationTitle).toBe('Test Title');
    expect(notificationMessage).toBe('Test Message');
  });

  test('calls onSaveState callback', async () => {
    const state = createMinimalState();
    let saveStateCalled = false;
    await stopFarmingSession(state, {
      onSaveState: async () => {
        saveStateCalled = true;
      },
    });
    expect(saveStateCalled).toBe(true);
  });

  test('calls onSaveTimingState callback', async () => {
    const state = createMinimalState();
    let saveTimingCalled = false;
    await stopFarmingSession(state, {
      onSaveTimingState: async () => {
        saveTimingCalled = true;
      },
    });
    expect(saveTimingCalled).toBe(true);
  });

  test('uses clearRotationMetadata when provided', async () => {
    const state = createMinimalState();
    let clearRotationCalled = false;
    await stopFarmingSession(state, {
      onClearRotationMetadata: (appState) => {
        clearRotationCalled = true;
        return appState;
      },
    });
    expect(clearRotationCalled).toBe(true);
  });
});

describe('advanceQueueIfCompleted', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns false when not running', async () => {
    const state = createMinimalState();
    state.appState.isRunning = false;
    const result = await advanceQueueIfCompleted(state, {});
    expect(result).toBe(false);
  });

  test('returns false when paused', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.isPaused = true;
    const result = await advanceQueueIfCompleted(state, {});
    expect(result).toBe(false);
  });

  test('returns true and advances when no drops are pending and all completed', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    const game1 = createGame({ id: 'game-1' });
    const game2 = createGame({ id: 'game-2' });
    state.appState.selectedGame = game1;
    state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.previousAllDropsCount = 1;
    state.appState.queue = [game2];
    state.appState.availableGames = [game2];

    const result = await advanceQueueIfCompleted(state, {
      onOpenStreamer: async () => true,
      onRefreshDropsData: async () => {
        state.appState.allDrops = [createDrop({ id: 'drop-2' })];
        state.appState.pendingDrops = [createDrop({ id: 'drop-2' })];
        state.appState.currentDrop = createDrop({ id: 'drop-2' });
      },
    });

    expect(result).toBe(true);
    expect(state.appState.selectedGame?.id).toBe('game-2');
  });

  test('advances to next game in queue when current completed', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    const nextGame = createGame({ id: 'game-2' });
    state.appState.queue = [nextGame];
    state.appState.availableGames = [nextGame];
    state.previousAllDropsCount = 1;

    let openStreamerCalled = false;
    await advanceQueueIfCompleted(state, {
      onOpenStreamer: async () => {
        openStreamerCalled = true;
        return true;
      },
      onRefreshDropsData: async () => {
        state.appState.pendingDrops = [createDrop({ id: 'drop-2' })];
        state.appState.currentDrop = createDrop({ id: 'drop-2' });
      },
    });

    expect(state.appState.selectedGame?.id).toBe('game-2');
    expect(openStreamerCalled).toBe(true);
  });

  test('skips completed games in queue', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    const game2 = createGame({ id: 'game-2' });
    const game3 = createGame({ id: 'game-3' });
    state.appState.queue = [game2, game3];
    state.appState.availableGames = [game2, game3];
    state.previousAllDropsCount = 1;

    let refreshCallCount = 0;
    await advanceQueueIfCompleted(state, {
      onRefreshDropsData: async () => {
        refreshCallCount++;
        if (refreshCallCount === 1) {
          state.appState.allDrops = [createDrop({ id: 'drop-2', claimed: true })];
          state.appState.pendingDrops = [];
          state.appState.currentDrop = null;
        } else {
          state.appState.allDrops = [createDrop({ id: 'drop-3' })];
          state.appState.pendingDrops = [createDrop({ id: 'drop-3' })];
          state.appState.currentDrop = createDrop({ id: 'drop-3' });
        }
      },
      onOpenStreamer: async () => true,
    });

    expect(state.appState.selectedGame?.id).toBe('game-3');
  });

  test('stops farming when queue is empty', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.appState.queue = [];
    state.previousAllDropsCount = 1;

    let stopMonitoringCalled = false;
    let alertSent = false;

    await advanceQueueIfCompleted(state, {
      onStopMonitoring: () => {
        stopMonitoringCalled = true;
      },
      onSendAlert: async () => {
        alertSent = true;
      },
      onApplyStopState: () => {},
    });

    expect(state.appState.isRunning).toBe(false);
    expect(stopMonitoringCalled).toBe(true);
    expect(alertSent).toBe(true);
  });

  test('closes managed tab when queue completes', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.appState.queue = [];
    state.appState.tabId = 123;
    state.previousAllDropsCount = 1;

    let closeTabCalled = false;
    await advanceQueueIfCompleted(state, {
      onCloseManagedTabIfSafe: async () => {
        closeTabCalled = true;
        return true;
      },
      onClearManagedTabOwnership: () => {},
      onApplyStopState: () => {},
      onStopMonitoring: () => {},
      onSendAlert: async () => {},
    });

    expect(closeTabCalled).toBe(true);
  });

  test('calls onSaveTimingState during advancement', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.appState.queue = [createGame({ id: 'game-2' })];
    state.previousAllDropsCount = 1;

    let saveTimingCalled = false;
    await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {
        saveTimingCalled = true;
      },
      onOpenStreamer: async () => true,
    });

    expect(saveTimingCalled).toBe(true);
  });

  test('resets tracking state when advancing to next game', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [createDrop({ claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.appState.queue = [createGame({ id: 'game-2' })];
    state.previousAllDropsCount = 1;
    state.invalidStreamChecks = 5;
    state.lastTrackedProgress = 50;

    await advanceQueueIfCompleted(state, {
      onOpenStreamer: async () => true,
    });

    expect(state.invalidStreamChecks).toBe(0);
    expect(state.lastTrackedProgress).toBe(-1);
    expect(state.previousAllDropsCount).toBe(0);
  });

  test('advances when campaign expired or vanished', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.allDrops = [];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.appState.queue = [createGame({ id: 'game-2' })];
    state.previousAllDropsCount = 5;

    let openStreamerCalled = false;
    await advanceQueueIfCompleted(state, {
      onOpenStreamer: async () => {
        openStreamerCalled = true;
        return true;
      },
    });

    expect(state.appState.selectedGame?.id).toBe('game-2');
    expect(openStreamerCalled).toBe(true);
  });
});

describe('skipCurrentGameDueToStall', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('removes current game from queue', async () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1', name: 'Game One' });
    const game2 = createGame({ id: 'game-2', name: 'Game Two' });
    state.appState.selectedGame = game1;
    state.appState.queue = [game1, game2];

    await skipCurrentGameDueToStall(state, {
      onOpenStreamer: async () => true,
    });

    expect(state.appState.queue.some(g => g.id === 'game-1')).toBe(false);
  });

  test('advances to next game in queue', async () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1', name: 'Game One' });
    const game2 = createGame({ id: 'game-2', name: 'Game Two' });
    state.appState.selectedGame = game1;
    state.appState.queue = [game1, game2];

    await skipCurrentGameDueToStall(state, {
      onOpenStreamer: async () => true,
    });

    expect(state.appState.selectedGame?.id).toBe('game-2');
  });

  test('resets stream tracking state', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.queue = [createGame({ id: 'game-2' })];
    state.invalidStreamChecks = 5;
    state.noProgressRotationAttempts = 3;

    await skipCurrentGameDueToStall(state, {
      onOpenStreamer: async () => true,
    });

    expect(state.invalidStreamChecks).toBe(0);
    expect(state.noProgressRotationAttempts).toBe(0);
  });

  test('stops farming when no more games in queue', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ id: 'game-1', name: 'Game One' });
    state.appState.queue = [];

    let stopFarmingCalled = false;
    let stopParams: { stopReason: string; stopMessage: string; notification: { title: string; message: string } } | null = null;

    await skipCurrentGameDueToStall(state, {
      onStopFarmingSession: async (params) => {
        stopFarmingCalled = true;
        stopParams = params;
      },
    });

    expect(stopFarmingCalled).toBe(true);
    expect(stopParams?.stopReason).toBe('stall-skipped');
    expect(stopParams?.notification.title).toBe('Farming stopped');
  });

  test('calls onSaveState after skipping', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ id: 'game-1' });
    state.appState.queue = [createGame({ id: 'game-2' })];

    let saveStateCalled = false;
    await skipCurrentGameDueToStall(state, {
      onOpenStreamer: async () => true,
      onSaveState: async () => {
        saveStateCalled = true;
      },
    });

    expect(saveStateCalled).toBe(true);
  });

  test('skips games with no pending drops', async () => {
    const state = createMinimalState();
    const game1 = createGame({ id: 'game-1', name: 'Game One' });
    const game2 = createGame({ id: 'game-2' });
    const game3 = createGame({ id: 'game-3' });
    state.appState.selectedGame = game1;
    state.appState.queue = [game2, game3];
    state.appState.availableGames = [game2, game3];

    let refreshCallCount = 0;
    await skipCurrentGameDueToStall(state, {
      onRefreshDropsData: async () => {
        refreshCallCount++;
        if (refreshCallCount === 1) {
          state.appState.allDrops = [createDrop({ id: 'drop-2', claimed: true })];
          state.appState.pendingDrops = [];
          state.appState.currentDrop = null;
        } else {
          state.appState.allDrops = [createDrop({ id: 'drop-3' })];
          state.appState.pendingDrops = [createDrop({ id: 'drop-3' })];
          state.appState.currentDrop = createDrop({ id: 'drop-3' });
        }
      },
      onOpenStreamer: async () => true,
    });

    expect(state.appState.selectedGame?.id).toBe('game-3');
  });

  test('sends notification when game is skipped', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ id: 'game-1', name: 'Game One' });
    state.appState.queue = [createGame({ id: 'game-2', name: 'Game Two' })];
    state.appState.pendingDrops = [createDrop()];

    await skipCurrentGameDueToStall(state, {
      onOpenStreamer: async () => true,
    });
  });
});

describe('handleStartFarming', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns error when no game provided', async () => {
    const state = createMinimalState();
    const result = await handleStartFarming(state, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('No game selected.');
  });

  test('tracks activity on start', async () => {
    const state = createMinimalState();
    let trackActivityCalled = false;
    await handleStartFarming(state, { game: createGame() }, {
      onTrackActivity: async () => {
        trackActivityCalled = true;
      },
    });
    expect(trackActivityCalled).toBe(true);
  });

  test('adds game to front of queue', async () => {
    const state = createMinimalState();
    const existingGame = createGame({ id: 'existing', name: 'Existing Game' });
    const newGame = createGame({ id: 'new', name: 'New Game' });
    state.appState.queue = [existingGame];
    state.appState.pendingDrops = [createDrop()];
    state.appState.availableGames = [existingGame, newGame];

    await handleStartFarming(state, { game: newGame });

    expect(state.appState.queue[0].id).toBe('new');
    expect(state.appState.queue[1].id).toBe('existing');
  });

  test('sets selected game to first in queue', async () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1' });
    state.appState.pendingDrops = [createDrop()];
    state.appState.availableGames = [game];

    await handleStartFarming(state, { game });

    expect(state.appState.selectedGame?.id).toBe('game-1');
  });

  test('sets isRunning to true and isPaused to false', async () => {
    const state = createMinimalState();
    state.appState.isRunning = false;
    state.appState.isPaused = true;
    state.appState.pendingDrops = [createDrop()];

    await handleStartFarming(state, { game: createGame() });

    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(false);
  });

  test('clears stop state and recovery state', async () => {
    const state = createMinimalState();
    state.appState.lastStopReason = 'previous-stop';
    state.appState.recoveryReason = 'previous-recovery';
    state.stalledRecoveryAttempts = 3;

    await handleStartFarming(state, { game: createGame() });

    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.lastStopMessage).toBeNull();
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.appState.recoveryReason).toBeNull();
  });

  test('resets stream tracking state', async () => {
    const state = createMinimalState();
    state.invalidStreamChecks = 5;
    state.noProgressRotationAttempts = 3;

    await handleStartFarming(state, { game: createGame() });

    expect(state.invalidStreamChecks).toBe(0);
    expect(state.noProgressRotationAttempts).toBe(0);
  });

  test('returns error when no farmable drops available', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;

    const result = await handleStartFarming(state, { game: createGame() });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No farmable drops for this game.');
    expect(state.appState.isRunning).toBe(false);
  });

  test('removes game from queue when no farmable drops', async () => {
    const state = createMinimalState();
    const game = createGame({ id: 'game-1' });
    state.appState.queue = [game];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;

    await handleStartFarming(state, { game });

    expect(state.appState.queue.some(g => g.id === 'game-1')).toBe(false);
  });

  test('calls onEnsureWorkspace', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [createDrop()];

    let ensureWorkspaceCalled = false;
    await handleStartFarming(state, { game: createGame() }, {
      onEnsureWorkspace: async () => {
        ensureWorkspaceCalled = true;
      },
    });

    expect(ensureWorkspaceCalled).toBe(true);
  });

  test('calls onRefreshDropsData with correct options', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [createDrop()];

    let refreshOptions: { includeCampaignFetch: boolean; includeInventoryFetch: boolean; suppressNotifications: boolean } | null = null;
    await handleStartFarming(state, { game: createGame() }, {
      onRefreshDropsData: async (options) => {
        refreshOptions = options;
      },
    });

    expect(refreshOptions?.includeCampaignFetch).toBe(true);
    expect(refreshOptions?.includeInventoryFetch).toBe(true);
    expect(refreshOptions?.suppressNotifications).toBe(true);
  });

  test('clears drop claim state', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [createDrop()];
    state.dropClaimRetryAtById.set('drop-1', Date.now());
    state.dropClaimInFlight = true;

    await handleStartFarming(state, { game: createGame() });

    expect(state.dropClaimRetryAtById.size).toBe(0);
    expect(state.dropClaimInFlight).toBe(false);
  });

  test('returns success when farmable drops exist', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [createDrop()];

    const result = await handleStartFarming(state, { game: createGame() });

    expect(result.success).toBe(true);
  });

  test('calls onSaveState on success', async () => {
    const state = createMinimalState();
    state.appState.pendingDrops = [createDrop()];

    let saveStateCalled = false;
    await handleStartFarming(state, { game: createGame() }, {
      onSaveState: async () => {
        saveStateCalled = true;
      },
    });

    expect(saveStateCalled).toBe(true);
  });

  test('removes existing game from queue before adding to front', async () => {
    const state = createMinimalState();
    const otherGame = createGame({ id: 'other', name: 'Other Game' });
    const game = createGame({ id: 'game-1', name: 'Game One' });
    state.appState.queue = [otherGame, game];
    state.appState.pendingDrops = [createDrop()];
    state.appState.availableGames = [otherGame, game];

    await handleStartFarming(state, { game });

    const game1Count = state.appState.queue.filter(g => g.id === 'game-1').length;
    expect(game1Count).toBe(1);
    expect(state.appState.queue[0].id).toBe('game-1');
  });
});

describe('rotateStreamer', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('increments noProgressRotationAttempts for stalled-progress reason', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 0 });
    await rotateStreamer(state, 'stalled-progress', {});
    expect(state.noProgressRotationAttempts).toBe(1);
  });

  test('increments noProgressRotationAttempts for open-failed reason', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 0 });
    await rotateStreamer(state, 'open-failed', {});
    expect(state.noProgressRotationAttempts).toBe(1);
  });

  test('does not increment for other rotation reasons', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 0 });
    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => true,
    });
    expect(state.noProgressRotationAttempts).toBe(0);
  });

  test('enters persistent recovery when max attempts reached', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 3 });

    let enterRecoveryCalled = false;
    await rotateStreamer(state, 'stalled-progress', {
      onEnterPersistentRecovery: async () => {
        enterRecoveryCalled = true;
      },
    });

    expect(enterRecoveryCalled).toBe(true);
  });

  test('returns false when entering persistent recovery', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 3 });

    const result = await rotateStreamer(state, 'stalled-progress', {
      onEnterPersistentRecovery: async () => {},
    });

    expect(result).toBe(false);
  });

  test('sets rotation timestamps', async () => {
    const state = createMinimalState();
    const before = Date.now();

    await rotateStreamer(state, 'offline', {});

    expect(state.appState.lastRotationAt).toBeGreaterThanOrEqual(before);
    expect(state.lastStreamRotationAt).toBeGreaterThanOrEqual(before);
    expect(state.lastProgressAdvanceAt).toBeGreaterThanOrEqual(before);
  });

  test('sets lastRotationReason on appState', async () => {
    const state = createMinimalState();
    await rotateStreamer(state, 'offline', {});
    expect(state.appState.lastRotationReason).toBe('offline');
  });

  test('clears activeStreamer', async () => {
    const state = createMinimalState();
    state.appState.activeStreamer = { id: 'streamer-1', name: 'test', displayName: 'Test', isLive: true };

    await rotateStreamer(state, 'offline', {});

    expect(state.appState.activeStreamer).toBeNull();
  });

  test('calls onOpenStreamer', async () => {
    const state = createMinimalState();

    let openStreamerCalled = false;
    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => {
        openStreamerCalled = true;
        return true;
      },
    });

    expect(openStreamerCalled).toBe(true);
  });

  test('returns true when streamer opened successfully', async () => {
    const state = createMinimalState();

    const result = await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => true,
    });

    expect(result).toBe(true);
  });

  test('returns false when streamer open fails', async () => {
    const state = createMinimalState();

    const result = await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => false,
    });

    expect(result).toBe(false);
  });

  test('increments attempts when open fails and reason does not count', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 0 });

    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => false,
    });

    expect(state.noProgressRotationAttempts).toBe(1);
  });

  test('enters recovery when open fails and max attempts reached', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 3 });

    let enterRecoveryCalled = false;
    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => false,
      onEnterPersistentRecovery: async () => {
        enterRecoveryCalled = true;
      },
    });

    expect(enterRecoveryCalled).toBe(true);
  });

  test('calls onSaveState', async () => {
    const state = createMinimalState();

    let saveStateCalled = false;
    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => true,
      onSaveState: async () => {
        saveStateCalled = true;
      },
    });

    expect(saveStateCalled).toBe(true);
  });

  test('calls onSaveTimingState', async () => {
    const state = createMinimalState();

    let saveTimingCalled = false;
    await rotateStreamer(state, 'offline', {
      onOpenStreamer: async () => true,
      onSaveTimingState: async () => {
        saveTimingCalled = true;
      },
    });

    expect(saveTimingCalled).toBe(true);
  });

  test('calls onSaveTimingState even when entering recovery', async () => {
    const state = createMinimalState({ noProgressRotationAttempts: 3 });

    let saveTimingCalled = false;
    await rotateStreamer(state, 'stalled-progress', {
      onEnterPersistentRecovery: async () => {},
      onSaveTimingState: async () => {
        saveTimingCalled = true;
      },
    });

    expect(saveTimingCalled).toBe(true);
  });
});

describe('rotateStreamerIfInvalid', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns early if no selected game', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = null;

    let rotateStreamerCalled = false;
    await rotateStreamerIfInvalid(state, {
      onRotateStreamer: async () => {
        rotateStreamerCalled = true;
      },
    });

    expect(rotateStreamerCalled).toBe(false);
  });

  test('rotates when no tabId and not in recovery backoff', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = null;
    state.recoveryBackoffUntil = 0;

    let rotateReason: StreamRotationReason | null = null;
    await rotateStreamerIfInvalid(state, {
      onRotateStreamer: async (_, reason) => {
        rotateReason = reason;
      },
    });

    expect(rotateReason).toBe('open-failed');
  });

  test('does not rotate when in recovery backoff for open-failed', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = null;
    state.recoveryBackoffUntil = Date.now() + 60000;
    state.appState.recoveryReason = 'open-failed';

    let rotateStreamerCalled = false;
    await rotateStreamerIfInvalid(state, {
      onRotateStreamer: async () => {
        rotateStreamerCalled = true;
      },
    });

    expect(rotateStreamerCalled).toBe(false);
  });

  test('clears tabId when tab not found', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 999;
    mocks.tabs.setTabsGetResult(null as unknown as { id?: number; url?: string });

    await rotateStreamerIfInvalid(state, {
      onRotateStreamer: async () => {},
    });

    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
  });

  test('returns early during stream validation grace period', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.streamValidationGraceUntil = Date.now() + 60000;

    let fetchContextCalled = false;
    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => {
        fetchContextCalled = true;
        return null;
      },
    });

    expect(fetchContextCalled).toBe(true);
  });

  test('increments invalidStreamChecks when context is null but on Twitch', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.invalidStreamChecks = 0;

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => null,
    });

    expect(state.invalidStreamChecks).toBe(1);
  });

  test('sets invalidStreamChecks to threshold when navigated away from Twitch', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.invalidStreamChecks = 0;
    state.lastStreamRotationAt = Date.now();

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://youtube.com/watch' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => null,
    });

    expect(state.invalidStreamChecks).toBe(8);
  });

  test('rotates when invalidStreamChecks reaches threshold', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.invalidStreamChecks = 7;
    state.lastStreamRotationAt = 0;

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    let rotateReason: StreamRotationReason | null = null;
    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => null,
      onRotateStreamer: async (_, reason) => {
        rotateReason = reason;
      },
    });

    expect(rotateReason).toBe('missing-context');
    expect(state.invalidStreamChecks).toBe(0);
  });

  test('does not rotate when within cooldown period', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.invalidStreamChecks = 8;
    state.lastStreamRotationAt = Date.now();

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    let rotateStreamerCalled = false;
    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => null,
      onRotateStreamer: async () => {
        rotateStreamerCalled = true;
      },
    });

    expect(rotateStreamerCalled).toBe(false);
  });

  test('resets invalidStreamChecks when stream is healthy', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.tabId = 123;
    state.invalidStreamChecks = 3;
    state.appState.activeStreamer = { id: 'streamer-1', name: 'streamer', displayName: 'Streamer', isLive: true };

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Playing Test Game',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
    });

    expect(state.invalidStreamChecks).toBe(0);
  });

  test('rotates immediately when stream is offline', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    state.appState.tabId = 123;
    state.appState.currentDrop = createDrop();
    state.lastProgressAdvanceAt = Date.now();

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    let rotateReason: StreamRotationReason | null = null;
    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: false,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
      onRotateStreamer: async (_, reason) => {
        rotateReason = reason;
      },
    });

    expect(rotateReason).toBe('offline');
  });

  test('enters recovery mode when progress is stalled', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    state.appState.tabId = 123;
    state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
    state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    let attemptSelfHealCalled = false;
    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
      onAttemptPlaybackSelfHeal: async () => {
        attemptSelfHealCalled = true;
      },
    });

    expect(attemptSelfHealCalled).toBe(true);
    expect(state.stalledRecoveryAttempts).toBeGreaterThan(0);
  });

  test('rotates when stalled and past recovery backoff', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    state.appState.tabId = 123;
    state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
    state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
    state.lastRecoveryAttemptAt = Date.now() - 5 * 60 * 1000;
    state.stalledRecoveryAttempts = 2;
    state.invalidStreamChecks = 8;
    state.lastStreamRotationAt = 0;
    state.appState.recoveryBackoffUntil = Date.now() - 60 * 1000;
    state.appState.recoveryReason = 'stalled-progress';

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    let rotateReason: StreamRotationReason | null = null;
    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
      onRotateStreamer: async (_, reason) => {
        rotateReason = reason;
      },
    });

    expect(rotateReason).toBe('stalled-progress');
  });

  test('does not increment checks when progress is live with weak signal', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    state.appState.tabId = 123;
    state.appState.currentDrop = createDrop();
    state.lastProgressAdvanceAt = Date.now();
    state.invalidStreamChecks = 3;

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: false,
        hasDropsSignal: false,
        isLive: true,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
    });

    expect(state.invalidStreamChecks).toBe(0);
  });

  test('clears recovery state when rotating from offline after stalled recovery', async () => {
    const state = createMinimalState();
    state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    state.appState.tabId = 123;
    state.appState.currentDrop = createDrop();
    state.appState.recoveryReason = 'stalled-progress';
    state.stalledRecoveryAttempts = 2;
    state.lastProgressAdvanceAt = Date.now();

    mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

    await rotateStreamerIfInvalid(state, {
      onFetchStreamContext: async () => ({
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: false,
        pageUrl: 'https://twitch.tv/streamer',
      }),
      onResolveCategorySlug: async () => 'test-game',
      onRotateStreamer: async () => {},
    });

    expect(state.appState.recoveryReason).toBeNull();
    expect(state.stalledRecoveryAttempts).toBe(0);
  });
});
