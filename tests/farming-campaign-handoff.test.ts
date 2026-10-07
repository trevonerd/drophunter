import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { loadClaimLog } from '../src/background/claim-log.ts';
import { dropStateKey } from '../src/background/drops-projection.ts';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import { broadcastStateUpdate, saveState } from '../src/background/state-persistence.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { required } from './support/required.ts';

describe('campaign handoff through the farming session', () => {
  let mocks: ReturnType<typeof setupChromeMocks>;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  function fixture(
    options: {
      candidateSucceeds?: boolean;
      beforeCandidateOpen?: () => Promise<void>;
      saveState?: FarmingSessionAdapters['saveState'];
      saveTimingState?: FarmingSessionAdapters['saveTimingState'];
      broadcastStateUpdate?: FarmingSessionAdapters['broadcastStateUpdate'];
      snapshotDrops?: (drops: TwitchDrop[]) => TwitchDrop[];
    } = {},
  ) {
    const games = ['smite', 'r6'].map((id) =>
      createGame({
        id,
        name: id,
        campaignId: `${id}-campaign`,
        categorySlug: id,
        dropCount: 1,
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      }),
    );
    const drops = games.map((game) =>
      createDrop({
        id: `${game.id}-drop`,
        gameId: game.id,
        campaignId: game.campaignId,
        requiredMinutes: 60,
      }),
    );
    const state = createMinimalState();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      selectedGame: games[0],
      queue: games,
      availableGames: games,
      allDrops: [drops[0]],
      pendingDrops: [drops[0]],
      currentDrop: drops[0],
      watchTransportPreference: 'managed-tab',
    });
    state.cachedDropsSnapshot = drops;
    let opens = 0;
    const probes: (string | undefined)[] = [];
    const disposed: string[] = [];
    const persisted: {
      selected: string | undefined;
      publicSelected: string | undefined;
      ownedChannel: string | undefined;
    }[] = [];
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async (target) => {
          const first = ++opens === 1;
          if (!first) {
            await options.beforeCandidateOpen?.();
          }
          const tabId = first ? 17 : 23;
          return {
            owner: 'drophunter',
            tabId,
            ownership: {
              kind: 'managed-tab',
              tabId,
              ownershipToken: `${target.campaignId}-owner`,
              expectedChannel: target.channelName,
            },
            health:
              !first && !options.candidateSucceeds
                ? createWatchHealth('managed-tab', 'failed', 'playback-inactive', Date.now)
                : undefined,
            dispose: async () => {
              disposed.push(target.channelName);
            },
          };
        },
        probe: async (_, target) => {
          probes.push(target.campaignId);
          return { accepted: true, progress: 1 };
        },
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: coordinator,
        fetchDirectoryStreamersFromApi: async (game) =>
          Object.assign([createStreamer({ name: `${game.id}-streamer` })], { languageFilterApplied: true }),
        fetchDropsSnapshotFromApi: async () => ({
          games,
          drops: options.snapshotDrops?.(drops) ?? drops,
          campaignsVerified: true,
          inventoryVerified: true,
          updatedAt: Date.now(),
        }),
        fetchInventorySnapshotFromApi: async () => ({
          games,
          drops: options.snapshotDrops?.(drops) ?? drops,
          inventoryVerified: true,
          updatedAt: Date.now(),
        }),
        saveState: async (next, saveOptions) => {
          const ownership = coordinator.currentOwnership();
          persisted.push({
            selected: next.appState.selectedGame?.campaignId,
            publicSelected: state.appState.selectedGame?.campaignId,
            ownedChannel: ownership?.kind === 'managed-tab' ? ownership.expectedChannel : undefined,
          });
          await options.saveState?.(next, saveOptions);
        },
        broadcastStateUpdate: options.broadcastStateUpdate ?? (() => {}),
        saveTimingState: options.saveTimingState ?? (async () => {}),
      }),
    );
    return { state, session, coordinator, games, drops, probes, disposed, persisted };
  }

  test('failed manual replacement retains the actual campaign and reports failure', async () => {
    const { state, session, coordinator, games, probes } = fixture();
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    const result = await session.handleSetSelectedGame({ game: required(games[1]) });
    await coordinator.tick();
    expect(result.success).toBe(false);
    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(probes.at(-1)).toBe('smite-campaign');
  });

  test('queued Play uses the shared campaign handoff and persists manual intent with the target', async () => {
    const { state, session, coordinator, games } = fixture({ candidateSucceeds: true });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    const result = await session.handleStartQueuedCampaign(gameKey(required(games[1])));
    await session.checkDropProgress();
    expect(result).toEqual({ success: true });
    expect(state.appState.selectedGame?.campaignId).toBe('r6-campaign');
    expect(state.appState.queue.map(gameKey)).toEqual([
      gameKey(required(games[1])),
      gameKey(required(games[0])),
    ]);
    expect(state.appState.forcedCampaignKey).toBe(gameKey(required(games[1])));
    expect(state.appState.farmingSessionOrigin).toBe('manual');
    expect(coordinator.currentTarget()?.campaignId).toBe('r6-campaign');
  });

  test('Drops sync completion during publication preserves the prepared watch and current sync status', async () => {
    let finishSync = true;
    const syncCompletedAt = Date.now() + 1_000;
    const subject = fixture({
      candidateSucceeds: true,
      saveState: async (next, options) => {
        if (finishSync && options?.deferPublicEffects && next.appState.activeStreamer) {
          finishSync = false;
          subject.state.appState.campaignSyncState = {
            ...subject.state.appState.campaignSyncState,
            status: 'idle',
            nextRetryAt: null,
            attemptDeadlineAt: null,
            lastSuccessAt: syncCompletedAt,
            campaignCount: 2,
          };
          subject.state.appState.lastDropsPageRefreshAttemptAt = syncCompletedAt - 100;
          subject.state.appState.lastSuccessfulRefreshAt = syncCompletedAt;
        }
      },
    });

    subject.state.appState.campaignSyncState = {
      ...subject.state.appState.campaignSyncState,
      status: 'syncing',
      nextRetryAt: null,
      attemptDeadlineAt: syncCompletedAt + 1_000,
    };
    expect(await subject.session.acquireStreamerForSelectedGame()).toBe(true);
    expect(finishSync).toBe(false);
    expect(subject.state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(subject.state.appState.watchHealth?.isHealthy).toBe(true);
    expect(subject.state.appState.campaignSyncState).toMatchObject({
      status: 'idle',
      lastSuccessAt: syncCompletedAt,
      campaignCount: 2,
    });
    expect(subject.state.appState.lastDropsPageRefreshAttemptAt).toBe(syncCompletedAt - 100);
    expect(subject.state.appState.lastSuccessfulRefreshAt).toBe(syncCompletedAt);
    expect(subject.disposed).toEqual([]);
  });

  test('publication cancellation keeps the same streamer retryable without warning or a failed round', async () => {
    let cancelPublication = true;
    const subject = fixture({
      candidateSucceeds: true,
      saveState: async (next, options) => {
        if (cancelPublication && options?.deferPublicEffects && next.appState.activeStreamer) {
          cancelPublication = false;
          subject.state.appState.notificationsEnabled = !subject.state.appState.notificationsEnabled;
        }
      },
    });
    const game = required(subject.games[0]);
    const key = gameKey(game);
    subject.state.appState.queue = [game];

    try {
      expect(await subject.session.acquireStreamerForSelectedGame()).toBe(false);
      expect(cancelPublication).toBe(false);
      expect(subject.state.appState.activeStreamer).toBeNull();
      expect(subject.state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
      expect(subject.state.appState.queueAcquisitionRound).toBeNull();
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames ?? []).toEqual([]);
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.watchAttempt).toBeUndefined();
      expect(mocks.chrome.alarms._created).toContainEqual({
        name: 'dropCheck',
        info: { when: expect.any(Number), periodInMinutes: 1 },
      });
      expect(subject.state.streamerAcquisitionInFlight).toBeNull();

      expect(await subject.session.acquireStreamerForSelectedGame()).toBe(true);
      expect(subject.state.appState.activeStreamer?.name).toBe('smite-streamer');
      expect(subject.coordinator.currentTarget()?.channelName).toBe('smite-streamer');
      expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
      expect(subject.state.appState.queueAcquisitionRound).toBeNull();
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
        'smite-streamer',
      ]);
    } finally {
      subject.session.stopMonitoring();
    }
  });

  test('cancelled acquisition wakes only after the real monitoring tick finishes saving', async () => {
    let cancelPublication = true;
    const preparing = Promise.withResolvers<void>();
    const finishPublication = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const subject = fixture({
      candidateSucceeds: true,
      saveState: async (next, options) => {
        if (cancelPublication && options?.deferPublicEffects && next.appState.activeStreamer) {
          cancelPublication = false;
          subject.state.appState.notificationsEnabled = !subject.state.appState.notificationsEnabled;
          preparing.resolve();
          await finishPublication.promise;
        }
      },
      saveTimingState: async (state) => {
        if (state.cancelledAcquisitionMonitoringWake) {
          reached.resolve();
          await release.promise;
        }
      },
    });
    subject.state.appState.queue = [required(subject.games[0])];
    const tick = subject.session.checkDropProgress();
    try {
      await preparing.promise;
      expect(subject.state.monitorTickInFlight).toBe(true);
      expect(mocks.chrome.alarms._created).toEqual([]);
      await subject.session.checkDropProgress();
      expect(mocks.chrome.alarms._created).toEqual([]);
      finishPublication.resolve();
      await reached.promise;
      expect(mocks.chrome.alarms._created).toEqual([]);
      expect(subject.state.cancelledAcquisitionMonitoringWake).not.toBeNull();
      release.resolve();
      await tick;
      expect(subject.state.monitorTickInFlight).toBe(false);
      expect(subject.state.cancelledAcquisitionMonitoringWake).toBeNull();
      expect(mocks.chrome.alarms._created).toEqual([
        {
          name: 'dropCheck',
          info: { when: expect.any(Number), periodInMinutes: 1 },
        },
      ]);
      expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
      expect(subject.state.appState.queueAcquisitionRound).toBeNull();
      expect(
        subject.state.appState.queueEntryMetadataByKey[gameKey(required(subject.games[0]))]
          ?.attemptedStreamerNames ?? [],
      ).toEqual([]);
    } finally {
      finishPublication.resolve();
      release.resolve();
      await tick;
      subject.session.stopMonitoring();
    }
  });

  test.each(['Pause', 'Stop', 'stale tick', 'cooldown'] as const)(
    'cancelled acquisition does not wake after %s',
    async (action) => {
      let cancelPublication = true;
      const subject = fixture({
        candidateSucceeds: true,
        saveState: async (next, options) => {
          if (cancelPublication && options?.deferPublicEffects && next.appState.activeStreamer) {
            cancelPublication = false;
            subject.state.appState.notificationsEnabled = !subject.state.appState.notificationsEnabled;
            if (action === 'Pause') await subject.session.handlePauseFarming();
            else if (action === 'Stop') await subject.session.handleStopFarming();
            else if (action === 'stale tick') subject.state.tickGeneration += 1;
            else subject.state.apiBackoffUntil = Date.now() + 60_000;
          }
        },
      });
      subject.state.appState.queue = [required(subject.games[0])];
      try {
        expect(await subject.session.acquireStreamerForSelectedGame()).toBe(false);
        expect(cancelPublication).toBe(false);
        expect(mocks.chrome.alarms._created).toEqual([]);
        expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
        expect(subject.state.appState.queueAcquisitionRound).toBeNull();
        expect(subject.state.appState.activeStreamer).toBeNull();
      } finally {
        subject.session.stopMonitoring();
      }
    },
  );

  test.each(['Pause', 'Stop', 'Play', 'stale tick', 'cooldown'] as const)(
    'pending cancellation wake is invalidated by %s before timing persistence finishes',
    async (action) => {
      let cancelPublication = true;
      let holdTiming = true;
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const subject = fixture({
        candidateSucceeds: true,
        saveState: async (next, options) => {
          if (cancelPublication && options?.deferPublicEffects && next.appState.activeStreamer) {
            cancelPublication = false;
            subject.state.appState.notificationsEnabled = !subject.state.appState.notificationsEnabled;
          }
        },
        saveTimingState: async (state) => {
          if (holdTiming && state.cancelledAcquisitionMonitoringWake) {
            reached.resolve();
            await release.promise;
          }
        },
      });
      const tick = subject.session.checkDropProgress();
      try {
        await reached.promise;
        holdTiming = false;
        expect(mocks.chrome.alarms._created).toEqual([]);
        if (action === 'Pause') await subject.session.handlePauseFarming();
        else if (action === 'Stop') await subject.session.handleStopFarming();
        else if (action === 'Play')
          await subject.session.handleStartQueuedCampaign(gameKey(required(subject.games[1])));
        else if (action === 'stale tick') subject.state.tickGeneration += 1;
        else subject.state.apiBackoffUntil = Date.now() + 60_000;
        const intentionalAlarms = [...mocks.chrome.alarms._created];
        release.resolve();
        await tick;
        expect(mocks.chrome.alarms._created).toEqual(intentionalAlarms);
        expect(subject.state.cancelledAcquisitionMonitoringWake).toBeNull();
        expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
        expect(subject.state.appState.queueAcquisitionRound).toBeNull();
        expect(
          subject.state.appState.queueEntryMetadataByKey[gameKey(required(subject.games[0]))]
            ?.attemptedStreamerNames ?? [],
        ).toEqual([]);
      } finally {
        holdTiming = false;
        release.resolve();
        await tick;
        subject.session.stopMonitoring();
      }
    },
  );

  test('late playback preparation after timeout retains the consumed streamer attempt', async () => {
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const subject = fixture({
      candidateSucceeds: true,
      beforeCandidateOpen: async () => {
        reached.resolve();
        await release.promise;
      },
    });
    const key = gameKey(required(subject.games[1]));
    await subject.coordinator.start(createStreamer({ name: 'smite-streamer' }));
    await subject.session.handleStartQueuedCampaign(key);
    const originalSetTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(
      new Proxy(originalSetTimeout, {
        apply(target, receiver, args) {
          if (args[1] === 60_000) args[1] = 20;
          return Reflect.apply(target, receiver, args);
        },
      }),
    );

    try {
      const acquisition = subject.session.acquireStreamerForSelectedGame();
      await reached.promise;
      expect(await acquisition).toBe(false);
      expect(subject.state.appState.recoveryReason).toBe('open-failed');
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
        'r6-streamer',
      ]);

      release.resolve();
      await new Promise<void>((resolve) => originalSetTimeout(resolve, 0));
      expect(subject.disposed).toEqual(['r6-streamer']);
      expect(subject.state.appState.activeStreamer).toBeNull();
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
        'r6-streamer',
      ]);
      expect(subject.state.appState.queueEntryMetadataByKey[key]?.watchAttempt?.channelName).toBe(
        'r6-streamer',
      );
      expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
    } finally {
      release.resolve();
      timer.mockRestore();
      subject.session.stopMonitoring();
    }
  });

  test('successful manual replacement persists the candidate before publishing its campaign and ownership', async () => {
    const { state, session, coordinator, games, persisted } = fixture({ candidateSucceeds: true });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));

    expect(await session.handleSetSelectedGame({ game: required(games[1]) })).toEqual({ success: true });

    expect(persisted).toContainEqual({
      selected: 'r6-campaign',
      publicSelected: 'smite-campaign',
      ownedChannel: 'smite-streamer',
    });
    expect(state.appState.selectedGame?.campaignId).toBe('r6-campaign');
    expect(state.appState.activeStreamer?.name).toBe('r6-streamer');
    expect(state.appState.currentDrop?.campaignId).toBe('r6-campaign');
    expect(state.appState.tabId).toBe(23);
    expect(coordinator.currentTarget()?.campaignId).toBe('r6-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 23, expectedChannel: 'r6-streamer' });
  });

  test('real persistence broadcasts the successor only after its ownership is promoted', async () => {
    const messages: unknown[] = [];
    mocks.chrome.runtime.sendMessage = (message) => {
      messages.push(message);
      return Promise.resolve(undefined);
    };
    const publications: {
      published: string | undefined;
      selected: string | undefined;
      target: string | undefined;
    }[] = [];
    const subject = fixture({
      candidateSucceeds: true,
      saveState,
      broadcastStateUpdate: (appState) => {
        publications.push({
          published: appState.selectedGame?.campaignId,
          selected: subject.state.appState.selectedGame?.campaignId,
          target: subject.coordinator.currentTarget()?.campaignId,
        });
        broadcastStateUpdate(appState);
      },
    });
    await subject.coordinator.start(createStreamer({ name: 'smite-streamer' }));

    expect(await subject.session.handleSetSelectedGame({ game: required(subject.games[1]) })).toEqual({
      success: true,
    });

    expect(publications).toEqual([
      { published: 'r6-campaign', selected: 'r6-campaign', target: 'r6-campaign' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      type: 'UPDATE_STATE',
      payload: {
        selectedGame: { campaignId: 'smite-campaign' },
        queueEntryMetadataByKey: { 'campaign:r6-campaign': { attemptedStreamerNames: ['r6-streamer'] } },
      },
    });
    for (const message of messages.slice(1)) {
      expect(message).toMatchObject({
        type: 'UPDATE_STATE',
        payload: { selectedGame: { campaignId: 'r6-campaign' } },
      });
    }
  });

  test('completion with a failed successor suspends the old watch and parks the unresolved successor', async () => {
    const { state, session, coordinator, drops, games } = fixture();
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    required(drops[0]).claimed = true;
    required(drops[0]).progress = 100;
    required(drops[0]).currentMinutes = 60;
    state.appState.pendingDrops = [];
    state.appState.completedDrops = [required(drops[0])];
    state.appState.currentDrop = null;

    await session.advanceQueueIfCompleted();

    expect(state.appState.selectedGame?.campaignId).toBe('r6-campaign');
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.watchHealth).toBeNull();
    expect(coordinator.currentTarget()).toBeNull();
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 17, expectedChannel: 'smite-streamer' });
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['r6-campaign']);
    expect(state.appState.queueEntryMetadataByKey[gameKey(required(games[1]))]).toMatchObject({
      streamerRetryReason: 'open-failed',
      attemptedStreamerNames: ['r6-streamer'],
    });
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeGreaterThan(Date.now());
  });

  test('storage failure disposes the prepared candidate and leaves the incumbent published', async () => {
    const { state, session, coordinator, games, disposed } = fixture({
      candidateSucceeds: true,
      saveState: async (next) => {
        if (next.appState.selectedGame?.campaignId === 'r6-campaign') throw new Error('storage unavailable');
      },
    });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));

    const result = await session.handleSetSelectedGame({ game: required(games[1]) });

    expect(result).toEqual({ success: false, error: 'Unable to save the campaign change.' });
    expect(disposed).toEqual(['r6-streamer']);
    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(state.appState.currentDrop?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentTarget()?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ expectedChannel: 'smite-streamer' });
  });

  test('completion cannot promote a successor whose prepared state cannot be saved', async () => {
    const { state, session, coordinator, games, drops, disposed } = fixture({
      candidateSucceeds: true,
      saveState: async (next) => {
        if (next.appState.selectedGame?.campaignId === 'r6-campaign') throw new Error('storage unavailable');
      },
    });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    required(drops[0]).claimed = true;
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    await expect(session.advanceQueueIfCompleted()).rejects.toThrow('storage unavailable');
    expect(disposed).toEqual(['r6-streamer']);
    expect(state.appState.selectedGame?.campaignId).toBe('r6-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ expectedChannel: 'smite-streamer' });
    expect(state.appState.queue).toEqual([required(games[1])]);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeGreaterThan(Date.now());
  });

  test('transport cleanup failure still persists terminal completion for reconstruction', async () => {
    let saved: ReturnType<typeof createMinimalState>['appState'] | undefined;
    const { state, session, coordinator, drops } = fixture({
      saveState: async (next) => {
        saved = structuredClone(next.appState);
      },
    });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    for (const drop of drops) drop.claimed = true;
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    const cleanup = spyOn(coordinator, 'stop').mockRejectedValue(new Error('cleanup unavailable'));
    try {
      expect(await session.advanceQueueIfCompleted()).toBe(false);
      const persisted = required(saved);
      expect(persisted.isRunning).toBe(false);
      expect(persisted.lastStopReason).toBe('queue-complete');
      expect(persisted.manualQueueAuthorized).toBe(false);
      expect(persisted.queue).toEqual([]);
    } finally {
      cleanup.mockRestore();
    }
  });

  test.each(['Stop', 'Pause'] as const)(
    '%s cancels completion while a real successor is preparing',
    async (action) => {
      const preparing = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const { state, session, coordinator, drops } = fixture({
        candidateSucceeds: true,
        beforeCandidateOpen: async () => {
          preparing.resolve();
          await release.promise;
        },
      });
      await coordinator.start(createStreamer({ name: 'smite-streamer' }));
      required(drops[0]).claimed = true;
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      const pending = session.advanceQueueIfCompleted();
      await preparing.promise;
      if (action === 'Stop') await session.handleStopFarming();
      else await session.handlePauseFarming();
      release.resolve();
      await pending;
      expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
      expect(coordinator.currentTarget()?.campaignId).not.toBe('r6-campaign');
      expect(state.appState.isRunning).toBe(action === 'Pause');
      expect(state.appState.isPaused).toBe(action === 'Pause');
      expect(state.appState.manualQueueAuthorized).toBe(action === 'Pause');
    },
  );

  test('a persistent storage outage prevents preparation before reserving the attempt', async () => {
    const { state, session, coordinator, games, disposed } = fixture({
      candidateSucceeds: true,
      saveState: async () => {
        throw new Error('storage unavailable');
      },
    });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));

    const result = await session.handleSetSelectedGame({ game: required(games[1]) });

    expect(result).toEqual({ success: false, error: 'Unable to save the campaign change.' });
    expect(disposed).toEqual([]);
    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentTarget()?.campaignId).toBe('smite-campaign');
  });

  for (const candidateSucceeds of [true, false]) {
    test(`claimed rewards discovered while preparing a ${candidateSucceeds ? 'successful' : 'failed'} handoff update the real lifetime counter once`, async () => {
      const { state, session, coordinator, games } = fixture({
        candidateSucceeds,
        snapshotDrops: (drops) =>
          drops.map((drop, index) =>
            index === 0 ? { ...drop, claimed: true, progress: 100, currentMinutes: 60 } : drop,
          ),
      });
      await coordinator.start(createStreamer({ name: 'smite-streamer' }));

      state.hasCurrentGenerationCampaignValidation = false;

      const result = await session.handleSetSelectedGame({ game: required(games[1]) });

      expect(result.success).toBe(candidateSucceeds);
      expect(await loadClaimLog()).toHaveLength(1);
      expect(state.appState.totalDropsClaimed).toBe(1);
      await session.refreshDropsData({ includeCampaignFetch: true });
      expect(state.appState.totalDropsClaimed).toBe(1);
      expect(await loadClaimLog()).toHaveLength(1);
    });
  }

  for (const action of ['Stop', 'Pause'] as const) {
    test(`${action} during candidate preparation prevents late promotion`, async () => {
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const { state, session, coordinator, games, disposed, persisted } = fixture({
        candidateSucceeds: true,
        beforeCandidateOpen: async () => {
          reached.resolve();
          await release.promise;
        },
      });
      await coordinator.start(createStreamer({ name: 'smite-streamer' }));
      const switching = session.handleSetSelectedGame({ game: required(games[1]) });
      await reached.promise;

      const interruption = action === 'Stop' ? session.handleStopFarming() : session.handlePauseFarming();
      release.resolve();
      const [result] = await Promise.all([switching, interruption]);

      expect(result.success).toBe(false);
      expect(disposed).toEqual(['r6-streamer']);
      expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
      expect(coordinator.currentTarget()).toBeNull();
      expect(persisted.some((entry) => entry.selected === 'r6-campaign')).toBe(false);
      if (action === 'Stop') {
        expect(state.appState.isRunning).toBe(false);
        expect(state.appState.lastStopReason).toBe('user-stop');
        expect(state.appState.manualQueueAuthorized).toBe(false);
      } else {
        expect(state.appState.isPaused).toBe(true);
        expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
          'smite-campaign',
          'r6-campaign',
        ]);
      }
    });
  }

  test('exhausted stall recovery cannot publish a successor whose playback failed', async () => {
    const { state, session, coordinator, games, drops } = fixture();
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    state.appState.recoveryReason = 'stalled-progress';
    state.appState.recoveryBackoffUntil = 0;
    state.recoveryBackoffUntil = 0;
    state.lastProgressAdvanceAt = Date.now() - 20 * 60_000;
    state.lastTrackedDropKey = dropStateKey(required(drops[0]));
    state.lastTrackedProgress = 0;
    state.lastTrackedMinutes = 0;
    state.appState.queueEntryMetadataByKey[gameKey(required(games[0]))] = {
      source: 'manual',
      addedAt: Date.now(),
      reason: 'user-added',
      attemptedStreamerNames: ['smite-streamer', 'older-1', 'older-2', 'older-3'],
    };

    await session.checkDropProgress();

    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer).toBeNull();
    expect(coordinator.currentTarget()).toBeNull();
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 17, expectedChannel: 'smite-streamer' });
    expect(state.appState.queueEntryMetadataByKey[gameKey(required(games[1]))]).toMatchObject({
      streamerRetryReason: 'open-failed',
      attemptedStreamerNames: ['r6-streamer'],
    });
    expect(state.appState.queueEntryMetadataByKey[gameKey(required(games[0]))]).toMatchObject({
      streamerRetryReason: 'stalled-progress',
    });
    expect(
      state.appState.queueEntryMetadataByKey[gameKey(required(games[0]))]?.streamerRetryAt,
    ).toBeGreaterThan(Date.now());
  });
});
