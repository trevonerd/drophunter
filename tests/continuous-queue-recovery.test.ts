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

verifyExpectedDiagnostics([]);
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
  state.appState.queueEntryMetadataByKey[gameKey(game)] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: Date.now(),
    streamerRetryReason: 'stalled-progress',
    streamerRetryAt: Date.now() + 60_000,
    parkedStreamerNames: ['known'],
  };
  expect(await acquireStreamerForSelectedGame(state, { onOpenStreamer: async () => true })).toBe(true);
  expect(state.appState.queueAcquisitionRound).not.toBeNull();
  projectDropsSnapshot(state, { games: [game], drops: [drop], updatedAt: Date.now() }, 'inventory-partial');
  expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryReason).toBe('stalled-progress');
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
  expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryReason).toBeUndefined();
  expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.parkedStreamerNames).toBeUndefined();
});

test('a refreshed eligible streamer preserves the round deadline until Retry or expiry', () => {
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
    parkedStreamerNames: ['known'],
  };
  const snapshot = normalizeFarmingAutomationSnapshot({ games: [game], drops: [], updatedAt: now });
  for (const name of ['known', 'new-streamer']) {
    const evidence = collectQueueAvailabilityEvidence(
      state,
      {
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
      },
      now,
    );
    expect(evidence.rehabilitatedCampaignKeys.has(key)).toBe(name === 'new-streamer');
    createQueueProgressionFixture(state).reconcileAvailability(evidence, now);
    if (name === 'known') expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
  }
  expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
  expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys).toContain(key);
  expect(state.appState.recoveryBackoffUntil).toBeNull();
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryReason).toBe('stalled-progress');
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryAt).toBe(now);
  expect(state.appState.queueEntryMetadataByKey[key]?.parkedStreamerNames).toBeUndefined();
  expect(state.appState.tabId).toBe(42);
});

test('a stalled park first records live streamers, then only a later new streamer ends the wait', () => {
  const now = Date.now();
  const game = createGame({ campaignId: 'stalled' });
  const key = gameKey(game);
  const state = createMinimalState();
  Object.assign(state.appState, { isRunning: true, manualQueueAuthorized: true, queue: [game] });
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: now,
    streamerRetryReason: 'stalled-progress',
    streamerRetryAt: now + 600_000,
    attemptedStreamerNames: ['tried'],
  };
  const snapshot = normalizeFarmingAutomationSnapshot({ games: [game], drops: [], updatedAt: now });
  const evaluate = (names: readonly string[]) => {
    const evidence = collectQueueAvailabilityEvidence(
      state,
      {
        kind: 'ready',
        snapshot,
        directories: new Map([
          [
            key,
            {
              streamers: names.map((name) => ({ id: name, name, displayName: name, isLive: true })),
              languageFilterApplied: true,
            },
          ],
        ]),
        availability: { [key]: { eligibleStreamerCount: names.length, updatedAt: now } },
        directoryFailures: new Set(),
      },
      now,
    );
    createQueueProgressionFixture(state).reconcileAvailability(evidence, now);
    return evidence.rehabilitatedCampaignKeys.has(key);
  };

  // Streamers already live when the park began are its baseline, not new evidence.
  expect(evaluate(['Tried', 'Untried'])).toBe(false);
  expect(state.appState.queueEntryMetadataByKey[key]?.parkedStreamerNames).toEqual(['tried', 'untried']);
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryAt).toBe(now + 600_000);
  expect(evaluate(['untried'])).toBe(false);

  expect(evaluate(['untried', 'newcomer'])).toBe(true);
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryAt).toBe(now);
  expect(state.appState.queueEntryMetadataByKey[key]?.parkedStreamerNames).toBeUndefined();
});

test('a legacy stall block loads as a stalled park that keeps its known-streamer baseline', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  spyOn(Date, 'now').mockImplementation(() => now);
  const [blocked, untouched] = ['blocked', 'untouched'].map((id) => createGame({ campaignId: id }));
  const restored = normalizeStoredAppState({
    queue: [blocked, untouched],
    queueEntryMetadataByKey: {
      [gameKey(untouched)]: {
        source: 'manual',
        reason: 'user-added',
        addedAt: 1,
        streamerRetryReason: 'open-failed',
        streamerRetryAt: now + 30_000,
      },
    },
    farmingSessionOrigin: 'manual',
    stalledCampaignBlocksByKey: {
      [gameKey(blocked)]: { blockedAt: 1, rotationAttempts: 3, eligibleStreamerNames: [' Known ', 'known'] },
      [gameKey(untouched)]: { blockedAt: 1, rotationAttempts: 3, eligibleStreamerNames: ['other'] },
      'campaign:not-queued': { blockedAt: 1, rotationAttempts: 3, eligibleStreamerNames: ['x'] },
    },
  });

  expect(restored).not.toHaveProperty('stalledCampaignBlocksByKey');
  expect(restored.queueEntryMetadataByKey[gameKey(blocked)]).toEqual({
    source: 'manual',
    reason: 'user-added',
    addedAt: now,
    streamerRetryReason: 'stalled-progress',
    streamerRetryAt: now + 60_000,
    parkedStreamerNames: ['known'],
  });
  // An existing park keeps its own reason; blocks never create metadata for unqueued campaigns.
  expect(restored.queueEntryMetadataByKey[gameKey(untouched)]?.streamerRetryReason).toBe('open-failed');
  expect(restored.queueEntryMetadataByKey['campaign:not-queued']).toBeUndefined();
});

test('every new stalled park discards the previous known-streamer baseline', async () => {
  const game = createGame({ campaignId: 'stalled' });
  const key = gameKey(game);
  const state = createMinimalState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    queue: [game],
    availableGames: [game],
    selectedGame: game,
  });
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: 1,
    parkedStreamerNames: ['stale'],
  };

  await createQueueProgressionFixture(state).skipCurrent('stalled-progress');

  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryReason).toBe('stalled-progress');
  expect(state.appState.queueEntryMetadataByKey[key]?.parkedStreamerNames).toBeUndefined();
});
