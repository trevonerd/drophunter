import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../../src/background/farming-automation.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createWatchTransportAdapters as createAdapters,
  createWatchHealth as createHealth,
  createWatchTransportState,
  createWatchTransportDrop as fixtureDrop,
  farmableSessionGame as game,
  watchTransportStreamer as streamer,
} from '../support/farming-session-watch-transport.ts';
import { createQueueAvailabilityReconciler } from '../support/queue-progression.ts';

let chromeMocks: ChromeMocks;

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

describe('farming session watch transport integration', () => {
  test('an exhausted Hidden recovery waits for the next round when no successor exists', async () => {
    const realDateNow = Date.now;
    const now = 5_000_000;
    Date.now = () => now;
    const state = createWatchTransportState(game);
    const currentDrop = fixtureDrop(game);
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.watchTransportPreference = 'tabless';
    state.lastProgressAdvanceAt = now - 600_000;
    state.appState.recoveryReason = 'stalled-progress';
    state.appState.recoveryAttempts = 3;
    state.stalledRecoveryAttempts = 3;
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      attemptedStreamerNames: ['channel-1', 'channel-2', 'channel-3', 'channel-4'],
      watchAttempt: { channelName: 'channel-1', observedAt: now - 600_000 },
    };
    state.recoveryBackoffUntil = now;

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [game],
            drops: [currentDrop],
            campaignsVerified: true,
            inventoryVerified: true,
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async (drops) => ({
            games: [game],
            drops,
            inventoryVerified: true,
            updatedAt: now,
          }),
          watchTransport: {
            start: async () => ({ kind: 'started', health: createHealth('tabless') }),
            tick: async () => createHealth('tabless'),
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(state.appState.queue.map((entry) => entry.campaignId)).toEqual([game.campaignId]);
      expect(state.appState.lastStopReason).toBeNull();
      expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
    } finally {
      Date.now = realDateNow;
    }
  });

  test('campaign suppression affects automatic selection only and leaves manual start available', async () => {
    const state = createWatchTransportState(game);
    state.appState.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: 1 }];
    const suppressedKeys: string[] = [];
    const automation = createFarmingAutomation({
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      evaluateBatch: async () => ({ kind: 'unchanged', reason: 'no-eligible-campaign' }),
      persistCampaignSuppression: async (campaignKey) => {
        suppressedKeys.push(campaignKey);
        return 'suppressed';
      },
    });

    await automation.suppressCampaignUntilRefresh(gameKey(game));
    const result = await createFarmingSession(state, createAdapters()).handleStartFarming({ game });

    expect(suppressedKeys).toEqual([gameKey(game)]);
    expect(result.success).toBe(true);
    expect(state.appState.favoriteGames).toHaveLength(1);
    expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
  });
});
