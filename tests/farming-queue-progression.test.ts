import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { collectQueueAvailabilityEvidence } from '../src/background/farming-automation-queue-planning.ts';
import { normalizeFarmingAutomationSnapshot } from '../src/background/farming-automation-twitch.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState, createStreamer } from './fixtures/queue-management.ts';
import { commitPreparedCampaign, createQueueProgressionFixture } from './support/queue-progression.ts';

const NOW = 2_000_000;
afterEach(() => mock.restore());

function fixture() {
  spyOn(Date, 'now').mockReturnValue(NOW);
  const completed = createGame({ id: 'shared', campaignId: 'completed' });
  const next = createGame({ id: 'shared', campaignId: 'next' });
  const state = createMinimalState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    selectedGame: completed,
    queue: [completed, next],
    availableGames: [completed, next],
    allDrops: [createDrop({ gameId: completed.id, campaignId: completed.campaignId, claimed: true })],
  });
  return { state, completed, next };
}

test.each(['stopped', 'paused', 'unvalidated'] as const)(
  'completion leaves a %s queue untouched',
  async (condition) => {
    const { state, completed, next } = fixture();
    if (condition === 'stopped') state.appState.isRunning = false;
    if (condition === 'paused') state.appState.isPaused = true;
    let attempts = 0;
    const progression = createQueueProgressionFixture(state, {
      validated: condition !== 'unvalidated',
      transitionCampaign: async () => {
        attempts += 1;
        return { kind: 'completed' };
      },
    });
    await progression.advanceIfCompleted();
    expect(attempts).toBe(0);
    expect(state.appState.queue).toEqual([completed, next]);
    expect(state.appState.selectedGame).toEqual(completed);
  },
);

test('completion removes only the selected campaign identity and commits its sibling', async () => {
  const { state, next } = fixture();
  expect(await createQueueProgressionFixture(state).advanceIfCompleted()).toBe(true);
  expect(state.appState.queue).toEqual([next]);
  expect(state.appState.selectedGame).toEqual(next);
  expect(state.appState.currentDrop?.campaignId).toBe(next.campaignId);
});

test('retry attempts every remaining identity once, then observes its next deadline', async () => {
  const { state, completed, next } = fixture();
  const visited: string[] = [];
  let now = NOW;
  spyOn(Date, 'now').mockImplementation(() => now);
  const progression = createQueueProgressionFixture(state, {
    transitionCampaign: async (game) => {
      visited.push(gameKey(game));
      return { kind: 'failed', reason: 'open-failed', error: 'playback unavailable' };
    },
  });
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [gameKey(completed)], nextRoundAt: now };
  expect(await progression.retryWaitingQueue()).toBe(false);
  expect(visited).toEqual([gameKey(next)]);
  const deadline = state.appState.queueAcquisitionRound?.nextRoundAt;
  expect(deadline).toBe(now + 600_000);
  expect(await progression.retryWaitingQueue()).toBe(false);
  expect(visited).toHaveLength(1);
  now = deadline!;
  expect(await progression.retryWaitingQueue()).toBe(false);
  expect(visited.slice(1)).toEqual([gameKey(completed), gameKey(next)]);
  expect(state.appState.manualQueueAuthorized).toBe(true);
});

test.each([true, false])(
  'availability evidence ignores a directory failure=%s without transport effects',
  (failed) => {
    const { state, next } = fixture();
    const key = gameKey(next);
    state.appState.queue = [next];
    state.appState.selectedGame = next;
    state.appState.activeStreamer = null;
    state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [key], nextRoundAt: NOW + 600_000 };
    state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      addedAt: 123,
      reason: 'user-added',
      streamerWaitState: 'availability',
      streamerRetryReason: 'no-streamers',
      streamerRetryAt: NOW + 600_000,
      streamerRetryCycles: 3,
    };
    let effects = 0;
    const progression = createQueueProgressionFixture(state, {
      transitionCampaign: async (game) => {
        effects += 1;
        return commitPreparedCampaign(state, game);
      },
      saveState: async () => {
        effects += 1;
      },
    });
    const evidence = collectQueueAvailabilityEvidence(state, {
      kind: 'ready',
      snapshot: normalizeFarmingAutomationSnapshot({ games: [next], drops: [], updatedAt: NOW }),
      directories: new Map(),
      availability: { [key]: { eligibleStreamerCount: 1, updatedAt: NOW } },
      directoryFailures: new Set(failed ? [key] : []),
    });
    progression.reconcileAvailability(evidence, NOW);
    expect(effects).toBe(0);
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(failed ? NOW + 600_000 : null);
    expect(state.appState.queueEntryMetadataByKey[key]).toMatchObject({
      source: 'manual',
      addedAt: 123,
      reason: 'user-added',
      streamerRetryReason: 'no-streamers',
    });
    expect(state.appState.queueEntryMetadataByKey[key]?.streamerWaitState).toBe(
      failed ? 'availability' : undefined,
    );
  },
);

test('positive availability preserves an incumbent watch and its campaign projection', () => {
  const { state, completed, next } = fixture();
  const key = gameKey(next);
  state.appState.activeStreamer = createStreamer();
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [key], nextRoundAt: NOW + 600_000 };
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: 1,
    streamerWaitState: 'availability',
  };
  const projection = structuredClone(state.appState.allDrops);
  createQueueProgressionFixture(state).reconcileAvailability(
    {
      eligibleCampaignKeys: new Set([key]),
      rehabilitatedCampaignKeys: new Set(),
    },
    NOW,
  );
  expect(state.appState.selectedGame).toEqual(completed);
  expect(state.appState.activeStreamer).not.toBeNull();
  expect(state.appState.allDrops).toEqual(projection);
});

test('availability with no current selection keeps unauthorized manual entries behind automatic favorites', () => {
  const { state, completed: manual, next: favorite } = fixture();
  Object.assign(state.appState, {
    selectedGame: null,
    activeStreamer: null,
    manualQueueAuthorized: false,
    farmingSessionOrigin: 'automatic',
    campaignPriorityMode: 'priority-list-only',
    queueAcquisitionRound: {
      attemptedCampaignKeys: [gameKey(manual), gameKey(favorite)],
      nextRoundAt: NOW + 600_000,
    },
  });
  for (const [game, source] of [
    [manual, 'manual'],
    [favorite, 'favorite-auto'],
  ] as const) {
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      source,
      reason: source === 'manual' ? 'user-added' : 'favorite-discovered',
      addedAt: 1,
      streamerWaitState: 'availability',
    };
  }
  createQueueProgressionFixture(state).reconcileAvailability(
    {
      eligibleCampaignKeys: new Set([gameKey(manual), gameKey(favorite)]),
      rehabilitatedCampaignKeys: new Set(),
    },
    NOW,
  );
  expect(state.appState.selectedGame).toEqual(favorite);
  expect(state.appState.queue).toEqual([favorite, manual]);
  expect(state.appState.manualQueueAuthorized).toBe(false);
});

test('terminal completion releases ownership, persists the stop and delivers completion once', async () => {
  const { state, completed } = fixture();
  state.appState.queue = [completed];
  state.appState.tabId = 42;
  const events: string[] = [];
  const progression = createQueueProgressionFixture(state, {
    closeManagedTabIfSafe: async (id) => {
      events.push(`release:${id}`);
      return true;
    },
    clearManagedTabOwnership: () => {
      state.appState.tabId = null;
    },
    stopMonitoring: () => {
      events.push('monitor');
    },
    sendAlert: async () => {
      events.push('completion');
    },
    saveState: async () => {
      events.push('persist');
    },
  });
  expect(await progression.advanceIfCompleted()).toBe(false);
  await progression.advanceIfCompleted();
  expect(events).toEqual(['release:42', 'monitor', 'completion', 'persist']);
  expect(state.appState.lastStopReason).toBe('queue-complete');
  expect(state.appState.manualQueueAuthorized).toBe(false);
});

test('a parking write failure stops progression before another candidate is prepared', async () => {
  const { state, next } = fixture();
  const other = createGame({ campaignId: 'other' });
  state.appState.queue.push(other);
  state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
  let attempts = 0;
  const progression = createQueueProgressionFixture(state, {
    transitionCampaign: async () => {
      attempts += 1;
      return { kind: 'failed', reason: 'open-failed', error: 'failed' };
    },
    saveState: async () => {
      throw new Error('storage unavailable');
    },
  });
  await expect(progression.advanceIfCompleted()).rejects.toThrow('storage unavailable');
  expect(attempts).toBe(1);
  expect(state.appState.activeStreamer?.name).toBe('incumbent');
  expect(state.appState.queue).toContainEqual(next);
  expect(state.appState.queue).toContainEqual(other);
});
