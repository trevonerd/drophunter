import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

const NOW = Date.parse('2026-10-06T10:00:00Z');
let chrome: ReturnType<typeof setupChromeMocks>;
let now = NOW;
beforeEach(() => {
  chrome = setupChromeMocks();
  now = NOW;
  spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  chrome.teardown();
  mock.restore();
});

function fixture(includeReadySuccessor = false) {
  const incumbent = createGame({ campaignId: 'completed', dropCount: 1 });
  const scheduled = createGame({ campaignId: 'scheduled' });
  const ready = createGame({ campaignId: 'ready' });
  const completedDrop = createDrop({ campaignId: incumbent.campaignId, claimed: true, progress: 100 });
  const scheduledDrop = createDrop({
    campaignId: scheduled.campaignId,
    startsAt: new Date(NOW + 60_000).toISOString(),
    requiredMinutes: 60,
  });
  const readyDrop = createDrop({ campaignId: ready.campaignId, requiredMinutes: 60 });
  const state = createMinimalState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.selectedGame = incumbent;
  state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
  state.appState.allDrops = [completedDrop];
  state.appState.completedDrops = [completedDrop];
  state.appState.queue = [incumbent, scheduled, ...(includeReadySuccessor ? [ready] : [])];
  state.appState.availableGames = [...state.appState.queue];
  state.cachedDropsSnapshot = [completedDrop, scheduledDrop, ...(includeReadySuccessor ? [readyDrop] : [])];
  let preparations = 0;
  const health = {
    mode: 'managed-tab' as const,
    status: 'healthy' as const,
    reason: 'started' as const,
    isHealthy: true,
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress: 0,
    shouldFallback: false,
    checkedAt: NOW,
  };
  const adapters = createFarmingSessionAdapters({
    fetchDropsSnapshotFromApi: async () => ({
      games: state.appState.availableGames,
      drops: state.cachedDropsSnapshot,
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: now,
    }),
    fetchDirectoryStreamersFromApi: async () =>
      Object.assign([createStreamer({ name: 'successor' })], { languageFilterApplied: true }),
    watchTransport: {
      start: async () => ({ kind: 'started', health }),
      stop: async () => {},
      tick: async () => health,
      setPreference: async () => {},
      prepare: async (target) => {
        preparations += 1;
        const ownership = {
          kind: 'managed-tab' as const,
          tabId: 18,
          ownershipToken: 'successor',
          expectedChannel: target.channelName,
        };
        return {
          kind: 'prepared',
          watch: {
            target,
            ownership,
            health,
            promote: () => ({ kind: 'promoted', ownership, obsolete: null }),
            dispose: async () => {},
          },
        };
      },
    },
  });
  const session = createFarmingSession(state, adapters);
  return { state, session, adapters, scheduled, ready, preparations: () => preparations };
}

test('a scheduled-only successor stays queued without preparing playback or completing the session', async () => {
  const subject = fixture();
  expect(await subject.session.advanceQueueIfCompleted()).toBe(true);
  expect(subject.state.appState.queue.map(gameKey)).toEqual([gameKey(subject.scheduled)]);
  expect(subject.state.appState.isRunning).toBe(true);
  expect(subject.state.appState.manualQueueAuthorized).toBe(true);
  expect(subject.preparations()).toBe(0);
});

test('a scheduled successor is parked while a ready campaign with the same game ID is farmed', async () => {
  const subject = fixture(true);
  expect(await subject.session.advanceQueueIfCompleted()).toBe(true);
  expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.ready.campaignId);
  expect(subject.state.appState.queue.map(gameKey)).toEqual([
    gameKey(subject.ready),
    gameKey(subject.scheduled),
  ]);
  expect(subject.preparations()).toBe(1);
});

test('a scheduled current campaign and successor both remain authorized without playback', async () => {
  const subject = fixture();
  const current = subject.state.appState.selectedGame;
  if (!current) throw new Error('Missing selected campaign');
  const future = createDrop({
    campaignId: current.campaignId,
    startsAt: new Date(NOW + 60_000).toISOString(),
  });
  subject.state.appState.allDrops = [future];
  subject.state.appState.pendingDrops = [future];
  subject.state.appState.completedDrops = [];
  subject.state.cachedDropsSnapshot[0] = future;
  expect(await subject.session.advanceQueueIfCompleted()).toBe(true);
  expect(subject.state.appState.queue).toHaveLength(2);
  expect(subject.state.appState.manualQueueAuthorized).toBe(true);
  expect(subject.preparations()).toBe(0);
});

test.each([false, true])(
  'a scheduled successor becomes eligible at the real retry deadline after reconstruction=%s',
  async (reconstruct) => {
    const subject = fixture();
    await subject.session.advanceQueueIfCompleted();
    const deadline = subject.state.appState.queueAcquisitionRound?.nextRoundAt;
    expect(deadline).toBeGreaterThan(NOW);
    let state = subject.state;
    let session = subject.session;
    if (reconstruct) {
      state = createServiceWorkerState();
      state.appState = normalizeStoredAppState(structuredClone(subject.state.appState));
      state.cachedDropsSnapshot = structuredClone(subject.state.cachedDropsSnapshot);
      session = createFarmingSession(state, subject.adapters);
    }
    if (deadline == null) throw new Error('Missing retry deadline');
    now = deadline - 1;
    expect(await session.acquireStreamerForSelectedGame()).toBe(false);
    expect(subject.preparations()).toBe(0);
    now += 1;
    expect(await session.acquireStreamerForSelectedGame()).toBe(true);
    expect(state.appState.selectedGame?.campaignId).toBe(subject.scheduled.campaignId);
    expect(state.appState.currentDrop?.campaignId).toBe(subject.scheduled.campaignId);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(subject.preparations()).toBe(1);
  },
);

test.each(['pause', 'stop'] as const)(
  'an all-scheduled queue respects %s before its retry deadline',
  async (action) => {
    const subject = fixture();
    await subject.session.advanceQueueIfCompleted();
    const deadline = subject.state.appState.queueAcquisitionRound?.nextRoundAt;
    if (action === 'pause') await subject.session.handlePauseFarming();
    else await subject.session.stop({ stopReason: 'user-stop' });
    if (deadline == null) throw new Error('Missing retry deadline');
    now = deadline + 1;
    expect(await subject.session.acquireStreamerForSelectedGame()).toBe(false);
    expect(subject.preparations()).toBe(0);
    expect(subject.state.appState.queue.map(gameKey)).toEqual([gameKey(subject.scheduled)]);
  },
);
