import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { collectQueueAvailabilityEvidence } from '../src/background/farming-automation-queue-planning.ts';
import { normalizeFarmingAutomationSnapshot } from '../src/background/farming-automation-twitch.ts';
import { prepareNextEligibleQueueHead } from '../src/background/session-lifecycle-queue-selection.ts';
import { acquireStreamerForSelectedGame } from '../src/background/streamer-acquisition.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';
import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';
import { createQueueProgressionFixture } from './support/queue-progression.ts';

verifyExpectedDiagnostics([
  ['[DropHunter] Parking campaign because no eligible Drops streamer was found', 6],
  ['[DropHunter] Parking campaign because eligible stream playback could not start', 6],
  ['[DropHunter] Giving up on game after stalled drop progress', 6],
]);
afterEach(() => mock.restore());

test.each(['no-streamers', 'open-failed', 'stalled-progress'] as const)(
  '%s campaigns keep their tab and authorization across repeated ten-minute rounds',
  async (reason) => {
    let now = Date.parse('2030-01-01T00:00:00Z');
    spyOn(Date, 'now').mockImplementation(() => now);
    const games = [0, 1, 2].map((index) => createGame({ campaignId: `campaign-${index}` }));
    const state = createMinimalState();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      queue: [...games],
      availableGames: games,
      selectedGame: games[0],
      tabId: 42,
      campaignPriorityMode: 'priority-list-only',
    });
    let stops = 0;
    for (let round = 0; round < 2; round += 1) {
      const visited: string[] = [];
      for (let index = 0; index < games.length; index += 1) {
        const selected = state.appState.selectedGame;
        if (!selected) throw new Error('Lost selected campaign');
        visited.push(gameKey(selected));
        if (reason === 'stalled-progress') {
          state.appState.stalledCampaignBlocksByKey[gameKey(selected)] = {
            blockedAt: now,
            rotationAttempts: 3,
            eligibleStreamerNames: ['known'],
            rewardProgressByKey: {},
          };
        }
        await createQueueProgressionFixture(state, {
          stopSession: async () => {
            stops += 1;
          },
        }).skipCurrent(reason);
        if (index < games.length - 1) {
          expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeNull();
          now += 60_000;
        }
      }
      expect(visited).toEqual(games.map(gameKey));
      expect(stops).toBe(0);
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.manualQueueAuthorized).toBe(true);
      expect(state.appState.tabId).toBe(42);
      expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
      expect(state.appState.recoveryBackoffUntil).toBe(now + 600_000);
      state.appState = normalizeStoredAppState(structuredClone(state.appState));
      now += 599_999;
      expect(prepareNextEligibleQueueHead(state, false)).toBeNull();
      now += 1;
      expect(prepareNextEligibleQueueHead(state, false)?.campaignId).toBe(games[0]?.campaignId);
    }
  },
);

test('opening playback preserves the round and stalled warning until authoritative progress advances', async () => {
  const state = createMinimalState();
  const game = createGame({ campaignId: 'stalled' });
  state.lastTrackedDropKey = null;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  const drop = createDrop({ campaignId: game.campaignId, progress: 10, currentMinutes: 6 });
  state.appState.selectedGame = game;
  state.appState.queue = [game];
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: ['campaign:previous'], nextRoundAt: null };
  state.appState.stalledCampaignBlocksByKey[gameKey(game)] = {
    blockedAt: Date.now(),
    rotationAttempts: 3,
    eligibleStreamerNames: ['known'],
    rewardProgressByKey: { [`${drop.id}::${game.campaignId}`]: { progress: 10, currentMinutes: 6 } },
  };
  expect(await acquireStreamerForSelectedGame(state, { onOpenStreamer: async () => true })).toBe(true);
  expect(state.appState.queueAcquisitionRound).not.toBeNull();
  projectDropsSnapshot(state, { games: [game], drops: [drop], updatedAt: Date.now() }, 'inventory-partial');
  expect(state.appState.stalledCampaignBlocksByKey[gameKey(game)]).toBeDefined();
  projectDropsSnapshot(
    state,
    {
      games: [game],
      drops: [{ ...drop, progress: 11, currentMinutes: 7 }],
      updatedAt: Date.now(),
    },
    'inventory-partial',
  );
  expect(state.appState.queueAcquisitionRound).toBeNull();
  expect(state.appState.stalledCampaignBlocksByKey[gameKey(game)]).toBeUndefined();
});

test('only a new eligible streamer ends a stalled round wait, preserving the warning until progress', () => {
  const now = Date.now();
  const game = createGame({ campaignId: 'stalled' });
  const key = gameKey(game);
  const state = createMinimalState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    queue: [game],
    selectedGame: game,
    availableGames: [game],
    activeStreamer: null,
    tabId: 42,
    queueAcquisitionRound: { attemptedCampaignKeys: [key], nextRoundAt: now + 600_000 },
  });
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: now,
    streamerRetryReason: 'stalled-progress',
    streamerRetryAt: now + 60_000,
  };
  state.appState.stalledCampaignBlocksByKey[key] = {
    blockedAt: now,
    rotationAttempts: 3,
    eligibleStreamerNames: ['known'],
    rewardProgressByKey: {},
  };
  const snapshot = normalizeFarmingAutomationSnapshot({ games: [game], drops: [], updatedAt: now });
  for (const name of ['known', 'new-streamer']) {
    const evidence = collectQueueAvailabilityEvidence(state, {
      kind: 'ready',
      snapshot,
      directories: new Map([
        [
          key,
          { streamers: [{ id: name, name, displayName: name, isLive: true }], languageFilterApplied: true },
        ],
      ]),
      availability: { [key]: { eligibleStreamerCount: 1, updatedAt: now } },
      directoryFailures: new Set(),
    });
    expect(state.appState.stalledCampaignBlocksByKey[key]).toBeDefined();
    createQueueProgressionFixture(state).reconcileAvailability(evidence, now);
    if (name === 'known') expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
  }
  expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeNull();
  expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys).not.toContain(key);
  expect(state.appState.recoveryBackoffUntil).toBe(now);
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryReason).toBe('stalled-progress');
  expect(state.appState.stalledCampaignBlocksByKey[key]).toBeUndefined();
  expect(state.appState.tabId).toBe(42);
});
