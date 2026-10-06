import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadClaimLog } from '../src/background/claim-log.ts';
import { dropStateKey } from '../src/background/drops-projection.ts';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import { broadcastStateUpdate, saveState } from '../src/background/state-persistence.ts';
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
            if (!options.candidateSucceeds) return null;
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
      }),
    );
    return { state, session, coordinator, games, drops, probes, disposed, persisted };
  }

  test('failed manual replacement retains the actual campaign and reports failure', async () => {
    const { state, session, coordinator, games, probes } = fixture();
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    const result = await session.handleSetSelectedGame({ game: games[1]! });
    await coordinator.tick();
    expect(result.success).toBe(false);
    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(probes.at(-1)).toBe('smite-campaign');
  });

  test('successful manual replacement persists the candidate before publishing its campaign and ownership', async () => {
    const { state, session, coordinator, games, persisted } = fixture({ candidateSucceeds: true });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));

    expect(await session.handleSetSelectedGame({ game: games[1]! })).toEqual({ success: true });

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

    expect(await subject.session.handleSetSelectedGame({ game: subject.games[1]! })).toEqual({
      success: true,
    });

    expect(publications).toEqual([
      { published: 'r6-campaign', selected: 'r6-campaign', target: 'r6-campaign' },
    ]);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatchObject({
        type: 'UPDATE_STATE',
        payload: { selectedGame: { campaignId: 'r6-campaign' } },
      });
    }
  });

  test('automatic completion with a failed successor retains the actual watch and parks only the successor', async () => {
    const { state, session, coordinator, drops, games } = fixture();
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));
    drops[0]!.claimed = true;
    drops[0]!.progress = 100;
    drops[0]!.currentMinutes = 60;
    state.appState.pendingDrops = [];
    state.appState.completedDrops = [drops[0]!];
    state.appState.currentDrop = null;

    await session.advanceQueueIfCompleted();

    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(state.appState.currentDrop).toBeNull();
    expect(coordinator.currentTarget()?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 17, expectedChannel: 'smite-streamer' });
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['r6-campaign']);
    expect(state.appState.queueEntryMetadataByKey[gameKey(games[1]!)]).toMatchObject({
      streamerRetryReason: 'open-failed',
      streamerRetryCycles: 1,
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

    const result = await session.handleSetSelectedGame({ game: games[1]! });

    expect(result).toEqual({ success: false, error: 'Unable to save the campaign change.' });
    expect(disposed).toEqual(['r6-streamer']);
    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(state.appState.currentDrop?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentTarget()?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ expectedChannel: 'smite-streamer' });
  });

  test('a persistent storage outage returns a failure after discarding the candidate', async () => {
    const { state, session, coordinator, games, disposed } = fixture({
      candidateSucceeds: true,
      saveState: async () => {
        throw new Error('storage unavailable');
      },
    });
    await coordinator.start(createStreamer({ name: 'smite-streamer' }));

    const result = await session.handleSetSelectedGame({ game: games[1]! });

    expect(result).toEqual({ success: false, error: 'Unable to save the campaign change.' });
    expect(disposed).toEqual(['r6-streamer']);
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

      const result = await session.handleSetSelectedGame({ game: games[1]! });

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
      const switching = session.handleSetSelectedGame({ game: games[1]! });
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
    state.lastTrackedDropKey = dropStateKey(drops[0]!);
    state.lastTrackedProgress = 0;
    state.lastTrackedMinutes = 0;
    state.appState.queueEntryMetadataByKey[gameKey(games[0]!)] = {
      source: 'manual',
      addedAt: Date.now(),
      reason: 'user-added',
      stalledStreamerNames: ['smite-streamer', 'older-1', 'older-2', 'older-3'],
    };

    await session.checkDropProgress();

    expect(state.appState.selectedGame?.campaignId).toBe('smite-campaign');
    expect(state.appState.activeStreamer?.name).toBe('smite-streamer');
    expect(state.appState.currentDrop?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentTarget()?.campaignId).toBe('smite-campaign');
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 17, expectedChannel: 'smite-streamer' });
    expect(state.appState.queueEntryMetadataByKey[gameKey(games[1]!)]).toMatchObject({
      streamerRetryReason: 'open-failed',
      streamerRetryCycles: 1,
    });
    expect(state.appState.queueEntryMetadataByKey[gameKey(games[0]!)]).toMatchObject({
      streamerRetryReason: 'stalled-progress',
    });
    expect(state.appState.queueEntryMetadataByKey[gameKey(games[0]!)]?.streamerRetryAt).toBeGreaterThan(
      Date.now(),
    );
  });
});
