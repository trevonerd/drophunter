import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchStreamer } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
const originalNow = Date.now;
let now: number;
beforeEach(() => {
  mocks = setupChromeMocks();
  now = originalNow();
  Date.now = () => now;
});
afterEach(() => {
  Date.now = originalNow;
  mocks.teardown();
});

function fixture(
  options: {
    running?: boolean;
    streamers?: TwitchStreamer[];
    drops?: (drops: TwitchDrop[]) => TwitchDrop[];
    beforeOpen?: () => Promise<void>;
    failPlayback?: boolean;
    failPersistence?: boolean;
    beforeSave?: () => Promise<void>;
    incumbentFails?: boolean;
    incumbentDropsMissing?: boolean;
    beforeProbe?: () => Promise<void>;
  } = {},
) {
  const games = ['first', 'second'].map((id) =>
    createGame({
      id,
      name: id,
      categorySlug: id,
      campaignId: `${id}-campaign`,
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    }),
  );
  const [first, requested] = games;
  if (!first || !requested) throw new Error('Two campaigns required');
  const drops = games.map((game) =>
    createDrop({ id: `${game.id}-drop`, gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 }),
  );
  const state = createServiceWorkerState();
  Object.assign(state.appState, {
    isRunning: options.running ?? false,
    selectedGame: options.running ? first : null,
    manualQueueAuthorized: options.running ?? false,
    farmingSessionOrigin: options.running ? 'manual' : null,
    queue: games,
    availableGames: games,
    watchTransportPreference: 'managed-tab',
  });
  state.cachedDropsSnapshot = drops;
  const opened: string[] = [];
  const persisted: string[] = [];
  const published: Array<{ campaign: string | undefined; dropCampaign: string | undefined }> = [];
  let directoryReads = 0;
  let refreshReads = 0;
  const effects: string[] = [];
  const coordinator = createWatchTransportCoordinator({
    state,
    heartbeat: async () => ({ accepted: true }),
    persist: async () => {
      published.push({
        campaign: state.appState.selectedGame?.campaignId,
        dropCampaign: state.appState.currentDrop?.campaignId,
      });
    },
    broadcast: () => {},
    managedTab: {
      open: async (target) => {
        opened.push(target.channelName);
        await options.beforeOpen?.();
        const failPlayback =
          options.failPlayback && (target.campaignId === requested.campaignId || options.incumbentFails);
        mocks.tabs.setTabsGetResult({ id: 19, url: `https://www.twitch.tv/${target.channelName}` });
        return {
          owner: 'drophunter',
          tabId: 19,
          ownership: {
            kind: 'managed-tab',
            tabId: 19,
            ownershipToken: `${target.channelName}-owned`,
            expectedChannel: target.channelName,
          },
          health: failPlayback
            ? createWatchHealth('managed-tab', 'failed', 'playback-inactive', Date.now)
            : undefined,
        };
      },
      probe: async () => {
        await options.beforeProbe?.();
        return {
          accepted: !options.incumbentFails,
          isLive: true,
          sameChannel: true,
          sameGame: true,
          hasDropsSignal: !options.incumbentDropsMissing,
          reason: 'heartbeat',
        };
      },
      close: async () => {},
    },
  });
  const snapshot = () => ({
    games,
    drops: options.drops?.(drops) ?? drops,
    campaignsVerified: true,
    inventoryVerified: true,
    updatedAt: Date.now(),
  });
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      watchTransport: coordinator,
      trackActivity: async () => {
        effects.push('activity');
      },
      openMonitorDashboardWindow: async () => {
        effects.push('monitor-window');
      },
      fetchDropsSnapshotFromApi: async () => {
        refreshReads++;
        return snapshot();
      },
      fetchInventorySnapshotFromApi: async () => snapshot(),
      fetchDirectoryStreamersFromApi: async (game) => {
        directoryReads++;
        return Object.assign(
          (game.campaignId === requested.campaignId || options.incumbentFails
            ? options.streamers
            : undefined) ?? [createStreamer({ name: `${game.id}_streamer` })],
          {
            languageFilterApplied: false,
          },
        );
      },
      saveState: async (next) => {
        await options.beforeSave?.();
        if (options.failPersistence) throw new Error('Disk unavailable');
        persisted.push(next.appState.selectedGame?.campaignId ?? 'none');
      },
    }),
  );
  return {
    state,
    session,
    first,
    requested,
    games,
    opened,
    persisted,
    published,
    coordinator,
    effects,
    reads: () => ({ directory: directoryReads, refresh: refreshReads }),
  };
}

describe('queued Play through the shared farming session', () => {
  test('Play persists the requested running campaign without checking Twitch until the main tick', async () => {
    const subject = fixture();
    expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
      success: true,
    });
    expect(subject.reads()).toEqual({ directory: 0, refresh: 0 });
    expect(subject.opened).toEqual([]);
    expect(subject.state.appState).toMatchObject({
      isRunning: true,
      activeStreamer: null,
      watchHealth: null,
    });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.requested.campaignId);
    await subject.session.checkDropProgress();
    expect(subject.opened).toEqual(['second_streamer']);
  });
  test('starts only the requested campaign and durably protects manual intent', async () => {
    const subject = fixture();
    expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
      success: true,
    });
    await subject.session.checkDropProgress();
    expect(subject.opened).toEqual(['second_streamer']);
    expect(subject.state.appState.queue.map(gameKey)).toEqual([
      gameKey(subject.requested),
      gameKey(subject.first),
    ]);
    expect(subject.state.appState).toMatchObject({
      isRunning: true,
      isPaused: false,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      forcedCampaignKey: gameKey(subject.requested),
    });
    expect(normalizeStoredAppState(structuredClone(subject.state.appState)).forcedCampaignKey).toBe(
      gameKey(subject.requested),
    );
    expect(subject.reads()).toEqual({ directory: 1, refresh: 0 });
  });

  test('is idempotent once the requested watch is running', async () => {
    const subject = fixture();
    await subject.session.handleStartQueuedCampaign(gameKey(subject.requested));
    await subject.session.checkDropProgress();
    expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
      success: true,
    });
    expect(subject.reads()).toEqual({ directory: 1, refresh: 0 });
    expect(subject.opened).toHaveLength(1);
  });

  test('concurrent duplicate commands share one start', async () => {
    const subject = fixture();
    const key = gameKey(subject.requested);
    expect(
      await Promise.all([
        subject.session.handleStartQueuedCampaign(key),
        subject.session.handleStartQueuedCampaign(key),
      ]),
    ).toEqual([{ success: true }, { success: true }]);
    await subject.session.checkDropProgress();
    expect(subject.opened).toHaveLength(1);
  });

  test('rejects another campaign of the same game that is not queued', async () => {
    const subject = fixture();
    expect(
      await subject.session.handleStartQueuedCampaign(gameKey({ ...subject.requested, campaignId: 'other' })),
    ).toEqual({ success: false, error: 'Campaign is no longer in the queue.' });
    expect(subject.reads()).toEqual({ directory: 0, refresh: 0 });
  });

  test.each(['no-streamers', 'playback'] as const)(
    'accepted replacement with %s failure follows normal queue order and parks the request',
    async (failure) => {
      const subject = fixture({
        running: true,
        streamers: failure === 'playback' ? ['a', 'b', 'c', 'd'].map((name) => createStreamer({ name })) : [],
        failPlayback: failure === 'playback',
      });
      subject.state.appState.activeStreamer = createStreamer({ name: 'first_streamer' });
      subject.coordinator.adopt({
        target: {
          gameId: subject.first.id,
          campaignId: subject.first.campaignId,
          channelName: 'first_streamer',
        },
        ownership: {
          kind: 'managed-tab',
          tabId: 19,
          ownershipToken: 'incumbent',
          expectedChannel: 'first_streamer',
        },
        health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
        obsolete: null,
      });
      expect((await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).success).toBe(
        true,
      );
      for (let attempt = 0; attempt < (failure === 'playback' ? 5 : 1); attempt++) {
        await subject.session.checkDropProgress();
        now += 31_000;
      }
      expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.first.campaignId);
      expect(subject.state.appState.activeStreamer?.name).toBe('first_streamer');
      expect(subject.state.appState.tabId).toBe(19);
      expect(
        subject.state.appState.queueEntryMetadataByKey[gameKey(subject.requested)]?.streamerRetryAt,
      ).toBeGreaterThan(Date.now());
      expect(subject.state.appState.manualQueueAuthorized).toBe(true);
    },
  );

  test('failed intent storage preserves the incumbent selection', async () => {
    const subject = fixture({ running: true, failPersistence: true });
    subject.state.appState.activeStreamer = createStreamer({ name: 'first_streamer' });
    expect((await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).success).toBe(false);
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.first.campaignId);
    expect(subject.state.appState.activeStreamer?.name).toBe('first_streamer');
    expect(subject.reads()).toEqual({ directory: 0, refresh: 0 });
  });

  test('a new Start supersedes pending preparation from the monitoring alarm', async () => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const subject = fixture({
      running: true,
      beforeOpen: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    await subject.session.handleStartQueuedCampaign(gameKey(subject.requested));
    const recovery = subject.session.checkDropProgress();
    await entered.promise;
    const newest = createGame({ id: 'third', campaignId: 'third-campaign' });
    expect(await subject.session.handleStartFarming({ game: newest })).toEqual({ success: true });
    release.resolve();
    await recovery;
    expect(subject.state.appState.selectedGame?.campaignId).toBe(newest.campaignId);
    expect(subject.state.appState.activeStreamer).toBeNull();
    expect(subject.coordinator.currentTarget()).toBeNull();
  });

  test('exhausted playback parks the requested campaign when the incumbent cannot be restored', async () => {
    const subject = fixture({
      running: true,
      failPlayback: true,
      incumbentFails: true,
      streamers: ['a', 'b', 'c', 'd'].map((name) => createStreamer({ name })),
    });
    subject.coordinator.adopt({
      target: {
        gameId: subject.first.id,
        campaignId: subject.first.campaignId,
        channelName: 'first_streamer',
      },
      ownership: {
        kind: 'managed-tab',
        tabId: 19,
        ownershipToken: 'incumbent',
        expectedChannel: 'first_streamer',
      },
      health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
      obsolete: null,
    });
    await subject.session.handleStartQueuedCampaign(gameKey(subject.requested));
    const key = gameKey(subject.requested);
    subject.state.appState.queueEntryMetadataByKey[key] = {
      ...subject.state.appState.queueEntryMetadataByKey[key],
    };
    await subject.session.checkDropProgress();
    now += 31_000;
    for (let attempt = 0; attempt < 9; attempt++) {
      await subject.session.checkDropProgress();
      now += 31_000;
    }
    expect(subject.state.appState.queueEntryMetadataByKey[key]?.streamerRetryAt).toBeGreaterThan(0);
    expect(
      subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames?.length ?? 0,
    ).toBeLessThanOrEqual(4);
    expect(subject.state.appState.activeStreamer).toBeNull();
    expect(subject.state.appState.queueAcquisitionRound).not.toBeNull();
    expect(subject.state.appState.forcedCampaignKey).toBeNull();
    const attempts = subject.opened.length;
    for (let tick = 0; tick < 5; tick += 1) await subject.session.checkDropProgress();
    expect(subject.opened).toHaveLength(attempts);
    expect(
      subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames?.length ?? 0,
    ).toBeLessThanOrEqual(4);
  });

  test('a failed incumbent proof never publishes the previous campaign or mismatched reward projection', async () => {
    const subject = fixture({ running: true, streamers: [], incumbentFails: true });
    subject.coordinator.adopt({
      target: {
        gameId: subject.first.id,
        campaignId: subject.first.campaignId,
        channelName: 'first_streamer',
      },
      ownership: {
        kind: 'managed-tab',
        tabId: 19,
        ownershipToken: 'incumbent',
        expectedChannel: 'first_streamer',
      },
      health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
      obsolete: null,
    });
    await subject.session.handleStartQueuedCampaign(gameKey(subject.requested));
    await subject.session.checkDropProgress();
    expect(
      subject.published.every(({ campaign, dropCampaign }) => !dropCampaign || campaign === dropCampaign),
    ).toBe(true);
    expect(subject.state.appState.activeStreamer).toBeNull();
  });

  test.each(['Stop', 'Pause'] as const)(
    '%s interrupts a pending queued start before playback settles',
    async (action) => {
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const subject = fixture({
        running: true,
        beforeOpen: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
        success: true,
      });
      const starting = subject.session.checkDropProgress();
      await entered.promise;
      await (action === 'Stop' ? subject.session.handleStopFarming() : subject.session.handlePauseFarming());
      expect(subject.state.appState.isPaused).toBe(action === 'Pause');
      release.resolve();
      await starting;
      expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.requested.campaignId);
      expect(subject.coordinator.currentTarget()).toBeNull();
    },
  );

  test('initial no-streamer start authorizes waiting for automatic recovery', async () => {
    const subject = fixture({ streamers: [], incumbentFails: true });
    expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
      success: true,
    });
    await subject.session.checkDropProgress();
    expect(subject.state.appState).toMatchObject({
      isRunning: true,
      manualQueueAuthorized: true,
      forcedCampaignKey: null,
      recoveryReason: 'no-streamers',
    });
    expect(subject.state.recoveryBackoffUntil).toBeGreaterThan(Date.now());
    expect(subject.state.appState.queue).toHaveLength(2);
  });

  test('future rewards remain selected and authorized until normal monitoring advances', async () => {
    const subject = fixture({
      drops: (drops) =>
        drops.map((drop) => ({ ...drop, startsAt: new Date(Date.now() + 60_000).toISOString() })),
    });
    expect(await subject.session.handleStartQueuedCampaign(gameKey(subject.requested))).toEqual({
      success: true,
    });
    await subject.session.checkDropProgress();
    expect(subject.state.appState).toMatchObject({
      isRunning: true,
      manualQueueAuthorized: true,
      currentDrop: null,
    });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.requested.campaignId);
    expect(subject.opened).toEqual([]);
  });

  test('explicit Play retries streamers previously excluded for a stall', async () => {
    const subject = fixture();
    const key = gameKey(subject.requested);
    subject.state.appState.queueEntryMetadataByKey[key] = {
      source: 'favorite-auto',
      reason: 'favorite-discovered',
      addedAt: 1,
      attemptedStreamerNames: ['second_streamer'],
      streamerRetryAt: Date.now() + 60_000,
    };
    expect(await subject.session.handleStartQueuedCampaign(key)).toEqual({ success: true });
    await subject.session.checkDropProgress();
    expect(subject.opened).toEqual(['second_streamer']);
    expect(subject.state.appState.queueEntryMetadataByKey[key]?.source).toBe('manual');
    expect(subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
      'second_streamer',
    ]);
  });

  test('initial Start keeps activity tracking and the configured monitor window', async () => {
    const subject = fixture();
    subject.state.appState.monitorAutoOpen = true;
    expect(await subject.session.handleStartFarming({ game: subject.requested })).toEqual({ success: true });
    expect(subject.effects).toEqual(['activity', 'monitor-window']);
  });

  test('Stop during waiting-state persistence cannot authorize farming late', async () => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    let firstSave = true;
    const subject = fixture({
      streamers: [],
      beforeSave: async () => {
        if (!firstSave) return;
        firstSave = false;
        entered.resolve();
        await release.promise;
      },
    });
    const starting = subject.session.handleStartQueuedCampaign(gameKey(subject.requested));
    await entered.promise;
    await subject.session.handleStopFarming();
    release.resolve();
    expect((await starting).success).toBe(false);
    expect(subject.state.appState.isRunning).toBe(false);
    expect(subject.state.appState.manualQueueAuthorized).toBe(false);
    expect(subject.state.appState.lastStopReason).toBe('user-stop');
  });
});
