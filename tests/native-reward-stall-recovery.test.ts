import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { STALLED_PROGRESS_RETRY_MS } from '../src/background/stream-rotation.ts';
import type { WatchHealth } from '../src/background/watch-transport.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let mocks: ChromeMocks;
beforeAll(() => {
  mocks = setupChromeMocks();
});
afterAll(() => mocks.teardown());

const game: TwitchGame = {
  id: 'resonance',
  name: 'Resonance',
  campaignId: 'launch',
  imageUrl: '',
  categorySlug: 'resonance',
  dropCount: 1,
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};
const nextGame: TwitchGame = { ...game, id: 'next', campaignId: 'next-launch' };
const streamer = { id: 'channel', name: 'channel', displayName: 'Channel', isLive: true };
const healthy: WatchHealth = {
  mode: 'tabless',
  isHealthy: true,
  status: 'healthy',
  reason: 'heartbeat',
  consecutiveFailures: 0,
  consecutiveStalls: 0,
  progress: 0,
  shouldFallback: false,
  checkedAt: 1,
};

function reward(rewardKind: TwitchDrop['rewardKind'], progress = 0): TwitchDrop {
  return {
    id: 'minotaur',
    name: 'Resonance Minotaur',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    campaignId: game.campaignId,
    progress,
    currentMinutes: progress,
    requiredMinutes: 100,
    remainingMinutes: 100 - progress,
    claimed: false,
    claimable: false,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind,
    verificationState: 'unassessed',
  };
}

function fixture(drop: TwitchDrop, nextDrops: TwitchDrop[], now: () => number, realTransport = false) {
  const state = createServiceWorkerState();
  const currentGame = {
    ...game,
    dropCount: 1 + nextDrops.filter((entry) => entry.campaignId === game.campaignId).length,
  };
  const games = nextDrops.some((entry) => entry.campaignId === nextGame.campaignId)
    ? [currentGame, nextGame]
    : [currentGame];
  const drops = [drop, ...nextDrops];
  Object.assign(state.appState, {
    selectedGame: currentGame,
    availableGames: games,
    queue: [...games],
    isRunning: true,
    activeStreamer: streamer,
    watchTransportMode: 'tabless',
    watchTransportPreference: 'tabless',
    allDrops: [drop],
    pendingDrops: [drop],
    currentDrop: drop,
  });
  state.cachedDropsSnapshot = drops;
  let ticks = 0;
  let savedMarkers = 0;
  const session = createFarmingSession(state, {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => ({ games, drops, updatedAt: now() }),
    fetchInventorySnapshotFromApi: async (current) => ({ games, drops: current, updatedAt: now() }),
    fetchDirectoryStreamersFromApi: async () => Object.assign([streamer], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => 'resonance',
    openForegroundChannel: async () => {},
    enforcePlaybackPolicyOnStreamTab: async () => {},
    attemptPlaybackSelfHeal: async () => {},
    attemptAutoClaimChannelPointsBonus: async () => false,
    closeManagedTabIfSafe: async () => true,
    clearManagedTabOwnership: () => {},
    openMonitorDashboardWindow: async () => {},
    sendAlert: async () => {},
    notify: async () => {},
    saveState: async () => {},
    saveTimingState: async () => {
      savedMarkers = Object.keys(state.unverifiableRewardsByKey).length;
    },
    broadcastStateUpdate: () => {},
    monitorAutoOpenDelayMs: 0,
    watchTransport: realTransport
      ? createWatchTransportCoordinator({
          state,
          now,
          persist: async () => {},
          broadcast: () => {},
          heartbeat: async () => ({ accepted: true, isLive: true, progress: 0 }),
          managedTab: {
            open: async () => null,
            probe: async () => ({ accepted: true }),
            close: async () => {},
          },
        })
      : {
          start: async () => healthy,
          stop: async () => {},
          setPreference: async () => {},
          tick: async () =>
            ++ticks === 1
              ? {
                  ...healthy,
                  status: 'stalled',
                  reason: 'stalled-progress',
                  isHealthy: false,
                  consecutiveStalls: 10,
                  shouldFallback: true,
                }
              : healthy,
        },
  });
  return { state, session, savedMarkers: () => savedMarkers };
}

test('real Hidden transport cannot restart forever when 0% progress stalls and managed fallback cannot open', async () => {
  const originalNow = Date.now;
  let now = 20_000_000;
  Date.now = () => now;
  try {
    const { state, session } = fixture(reward('twitch-badge'), [], () => now, true);
    for (let minute = 0; minute < 25 && state.appState.isRunning; minute += 1) {
      await session.checkDropProgress();
      now += 60_000;
    }
    expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(1);
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
    expect(state.appState.currentDrop).toBeNull();
    expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
  } finally {
    Date.now = originalNow;
  }
});

test('exhausted native reward hands off to an ordinary reward in the same campaign', async () => {
  const originalNow = Date.now;
  let now = 30_000_000;
  Date.now = () => now;
  try {
    const nextDrop = { ...reward('in-game'), id: 'ordinary' };
    const { state, session } = fixture(reward('twitch-badge', 99), [nextDrop], () => now);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await session.checkDropProgress();
      now += STALLED_PROGRESS_RETRY_MS;
    }
    expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(1);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.currentDrop?.id).toBe('ordinary');
    expect(state.appState.currentDrop?.verificationState).toBe('unassessed');
    expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    expect(state.appState.selectedGame?.rewardSummary?.completion).toBe('farmable');
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.appState.recoveryReason).toBeNull();
  } finally {
    Date.now = originalNow;
  }
});

for (const kind of ['twitch-badge', 'twitch-emote'] as const) {
  for (const progress of [0, 99]) {
    test(`${kind} at ${progress}% exhausts the public Hidden ladder and advances without claiming`, async () => {
      const originalNow = Date.now;
      let now = 10_000_000;
      Date.now = () => now;
      try {
        const drop = reward(kind, progress);
        const nextDrop = {
          ...reward('in-game'),
          id: 'next',
          gameId: nextGame.id,
          campaignId: nextGame.campaignId,
        };
        const { state, session, savedMarkers } = fixture(drop, [nextDrop], () => now);
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await session.checkDropProgress();
          expect(state.stalledRecoveryAttempts).toBe(attempt);
          expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(0);
          now += STALLED_PROGRESS_RETRY_MS;
        }
        await session.checkDropProgress();
        expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(1);
        expect(savedMarkers()).toBe(1);
        expect(state.cachedDropsSnapshot.find((entry) => entry.id === drop.id)).toMatchObject({
          verificationState: 'unverifiable',
          progress,
          claimed: false,
        });
        expect(state.appState.selectedGame?.campaignId).toBe(nextGame.campaignId);
        expect(state.appState.queue.map((entry) => entry.campaignId)).toEqual([nextGame.campaignId]);
        expect(state.appState.stalledCampaignBlocksByKey).toEqual({});
      } finally {
        Date.now = originalNow;
      }
    });
  }
}
