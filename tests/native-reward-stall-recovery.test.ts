import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { computeEffectiveStallThreshold } from '../src/background/stream-rotation.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, WatchTransportMode } from '../src/types/index.ts';
import { createFarmingSessionAdapters } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
const originalNow = Date.now;
let now: number;
beforeEach(() => {
  mocks = setupChromeMocks();
  now = 10_000_000;
  Date.now = () => now;
});
afterEach(() => {
  Date.now = originalNow;
  mocks.teardown();
});

function fixture(
  mode: WatchTransportMode,
  kind: TwitchDrop['rewardKind'],
  progress: number,
  successor: boolean,
) {
  const game: TwitchGame = {
    id: 'game',
    name: 'Game',
    campaignId: 'campaign',
    imageUrl: '',
    dropCount: 1,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
  const next: TwitchGame = { ...game, id: 'next', campaignId: 'next-campaign' };
  const drop: TwitchDrop = {
    id: 'native',
    gameId: game.id,
    gameName: game.name,
    campaignId: game.campaignId,
    name: 'Reward',
    imageUrl: '',
    progress,
    currentMinutes: progress,
    requiredMinutes: 100,
    remainingMinutes: 100 - progress,
    claimed: false,
    claimable: false,
    acquisitionMethod: 'watch-time',
    rewardKind: kind,
    verificationState: 'unassessed',
  };
  const games = successor ? [game, next] : [game];
  const drops = successor
    ? [
        drop,
        {
          ...drop,
          id: 'next-drop',
          gameId: next.id,
          campaignId: next.campaignId,
          rewardKind: 'in-game' as const,
          progress: 0,
          currentMinutes: 0,
        },
      ]
    : [drop];
  const state = createServiceWorkerState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    selectedGame: game,
    queue: games,
    availableGames: games,
    currentDrop: drop,
    pendingDrops: [drop],
    allDrops: [drop],
    watchTransportPreference: mode,
    watchTransportMode: mode,
    streamerSelectionMode: 'top-viewers',
  });
  state.cachedDropsSnapshot = drops;
  let managedOpens = 0;
  const starts: string[] = [];
  let previousChannel = '';
  const record = (channel: string) => {
    if (previousChannel !== channel) {
      starts.push(channel);
      previousChannel = channel;
    }
  };
  const transport = createWatchTransportCoordinator({
    state,
    now: () => now,
    persist: async () => {},
    broadcast: () => {},
    heartbeat: async (target) => {
      record(target.channelName);
      return { accepted: true, isLive: true };
    },
    managedTab: {
      open: async (target) => {
        managedOpens++;
        record(target.channelName);
        mocks.tabs.setTabsGetResult({ id: 17, url: `https://www.twitch.tv/${target.channelName}` });
        return {
          owner: 'drophunter',
          tabId: 17,
          ownership: {
            kind: 'managed-tab',
            tabId: 17,
            ownershipToken: target.channelName,
            expectedChannel: target.channelName,
          },
        };
      },
      probe: async () => ({ accepted: true, progress: 1 }),
      pause: async () => {},
      close: async () => {},
    },
  });
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      watchTransport: transport,
      fetchStreamContext: async () => ({
        channelName: state.appState.activeStreamer?.name ?? '',
        categorySlug: '',
        categoryLabel: 'Game',
        streamTitle: 'Drops',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        pageUrl: 'https://www.twitch.tv/live',
      }),
      fetchDirectoryStreamersFromApi: async (selected) =>
        Object.assign(
          (selected.campaignId === game.campaignId ? ['a', 'b', 'c', 'd'] : ['next']).map((name, i) => ({
            id: name,
            name,
            displayName: name,
            isLive: true,
            viewerCount: i + 1,
          })),
          { languageFilterApplied: true },
        ),
      fetchDropsSnapshotFromApi: async () => ({
        games,
        drops,
        updatedAt: now,
        campaignsVerified: true,
        inventoryVerified: true,
      }),
      fetchInventorySnapshotFromApi: async () => ({ games, drops, updatedAt: now, inventoryVerified: true }),
    }),
  );
  return { state, game, drop, session, starts, managedOpens: () => managedOpens };
}

for (const mode of ['tabless', 'managed-tab'] as const) {
  for (const kind of ['twitch-badge', 'twitch-emote'] as const) {
    for (const progress of [0, 99]) {
      test(`${mode}: ${kind} at ${progress}% keeps its proof unresolved and advances after four distinct streamers`, async () => {
        const f = fixture(mode, kind, progress, true);
        await f.session.checkDropProgress();
        for (let channel = 0; channel < 4; channel++) {
          await f.session.checkDropProgress();
          now += computeEffectiveStallThreshold(100) + 30_000;
          await f.session.checkDropProgress();
        }
        expect(f.starts.filter((name) => name !== 'next')).toEqual(['d', 'c', 'b', 'a']);
        expect(f.state.appState.selectedGame?.campaignId).toBe('next-campaign');
        expect(f.state.appState.isRunning).toBe(true);
        expect(f.state.appState.queue.map(gameKey)).toContain(gameKey(f.game));
        expect(f.state.cachedDropsSnapshot.find((drop) => drop.id === 'native')).toMatchObject({
          progress,
          claimed: false,
          verificationState: 'unassessed',
        });
        expect(f.state.unverifiableRewardsByKey).toEqual({});
        expect(f.state.appState.farmingSessionTargets[gameKey(f.game)]?.acquired).toBe(false);
        expect(Object.values(f.state.appState.campaignFailureEpisodesByKey)).toHaveLength(1);
        if (mode === 'tabless') expect(f.managedOpens()).toBe(0);
      });
    }
  }
  test(`${mode}: the only unresolved campaign suspends for ten minutes without fake acquisition`, async () => {
    const f = fixture(mode, 'twitch-badge', 0, false);
    await f.session.checkDropProgress();
    for (let channel = 0; channel < 4; channel++) {
      await f.session.checkDropProgress();
      now += computeEffectiveStallThreshold(100) + 30_000;
      await f.session.checkDropProgress();
    }
    expect(f.state.appState.isRunning).toBe(true);
    expect(f.state.appState.isPaused).toBe(false);
    expect(f.state.appState.activeStreamer).toBeNull();
    expect(f.state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
    expect(f.state.appState.lastStopReason).toBeNull();
    const deadline = f.state.appState.queueAcquisitionRound?.nextRoundAt;
    now += 30_000;
    await f.session.checkDropProgress();
    expect(f.state.appState.queueAcquisitionRound?.nextRoundAt).toBe(deadline);
    expect(f.starts).toEqual(['d', 'c', 'b', 'a']);
    if (mode === 'tabless') expect(f.managedOpens()).toBe(0);
  });
}
