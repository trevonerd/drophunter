import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { pushGameToQueue, removeGameFromQueue } from '../src/background/queue-operations.ts';
import { skipCurrentGameAndAdvanceQueue } from '../src/background/session-lifecycle-queue.ts';
import { prepareNextEligibleQueueHead } from '../src/background/session-lifecycle-queue-selection.ts';
import { stopFarmingSession } from '../src/background/session-lifecycle-stop.ts';
import { resetStateForInactivity } from '../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('queue acquisition rounds', () => {
  afterEach(() => {
    spyOn(Date, 'now').mockRestore();
  });

  test.each([
    1, 4, 10,
  ])('visits every campaign in a queue of %i before retrying a previous campaign', async (size) => {
    // Given: earlier deadlines become retryable while later campaigns are still waiting for their first turn.
    let now = Date.parse('2030-01-01T00:00:00Z');
    spyOn(Date, 'now').mockImplementation(() => now);
    const campaigns = Array.from({ length: size }, (_, index) =>
      createGame({
        id: 'shared-game',
        campaignId: `campaign-${index}`,
        name: `Campaign ${index}`,
        endsAt: new Date(now + (index + 1) * 86_400_000).toISOString(),
      }),
    );
    const state = createMinimalState();
    state.appState.queue = [...campaigns];
    state.appState.availableGames = [...campaigns];
    state.appState.selectedGame = campaigns[0] ?? null;
    state.appState.manualQueueAuthorized = true;
    const visited: string[] = [];
    // When: every attempted campaign returns a valid empty streamer directory after a variable delay.
    for (let index = 0; index < size; index += 1) {
      visited.push(state.appState.selectedGame?.campaignId ?? 'missing');
      now += 35_000 + index * 5_000;
      await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
        onSaveTimingState: async () => {},
        onSaveState: async () => {},
        onOpenStreamer: async () => false,
      });
    }
    // Then: each identity is visited once, the queue remains intact, and retry has a future deadline.
    expect(visited).toEqual(campaigns.map((game) => game.campaignId ?? 'missing'));
    expect(state.appState.queue).toHaveLength(size);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.recoveryBackoffUntil).toBeGreaterThan(now);
    expect(prepareNextEligibleQueueHead(state, false)).toBeNull();
    now += 120_000;
    expect(prepareNextEligibleQueueHead(state, false)?.campaignId).toBe(campaigns[0]?.campaignId);
    expect(state.appState.queueAcquisitionRound).toBeNull();
  });

  test('retains untried campaign precedence after a 72 hour restart', async () => {
    // Given: the first two campaigns failed before the laptop went to sleep.
    let now = Date.parse('2030-01-01T00:00:00Z');
    spyOn(Date, 'now').mockImplementation(() => now);
    const campaigns = Array.from({ length: 4 }, (_, index) =>
      createGame({
        campaignId: `restart-${index}`,
        endsAt: new Date(now + (index + 10) * 86_400_000).toISOString(),
      }),
    );
    const state = createMinimalState();
    state.appState.queue = campaigns;
    state.appState.selectedGame = campaigns[0] ?? null;
    state.appState.manualQueueAuthorized = true;
    for (let index = 0; index < 2; index += 1) {
      await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
        onSaveTimingState: async () => {},
        onSaveState: async () => {},
        onOpenStreamer: async () => false,
      });
      now += 35_000;
    }
    // When: durable state is restored after a simulated weekend.
    const restored = createMinimalState();
    restored.appState = normalizeStoredAppState(JSON.parse(JSON.stringify(state.appState)));
    now += 72 * 3_600_000;
    const next = prepareNextEligibleQueueHead(restored, false);
    // Then: elapsed cooldowns do not erase the remaining first turns or authorization.
    expect(next?.campaignId).toBe('restart-2');
    expect(restored.appState.queueAcquisitionRound?.attemptedCampaignKeys).toEqual([
      'campaign:restart-0',
      'campaign:restart-1',
    ]);
    expect(restored.appState.manualQueueAuthorized).toBe(true);
  });

  test('admits a newly added campaign before retrying an exhausted round', async () => {
    // Given: the only initial campaign failed and the round is waiting.
    const first = createGame({ campaignId: 'old' });
    const added = createGame({ campaignId: 'new' });
    const state = createMinimalState();
    state.appState.selectedGame = first;
    state.appState.queue = [first];
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: async () => {},
      onSaveState: async () => {},
    });
    // When: the user adds another campaign during the waiting period.
    state.appState.queue.push(added);
    const next = prepareNextEligibleQueueHead(state, false);
    // Then: that campaign gets its initial turn without clearing previous failure evidence.
    expect(next?.campaignId).toBe('new');
    expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys).toEqual([gameKey(first)]);
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeNull();
  });

  test('clears the durable round and manual authorization on Stop', async () => {
    // Given: a manually authorized queue is in a retry round.
    const state = createMinimalState();
    state.appState.manualQueueAuthorized = true;
    state.appState.queueAcquisitionRound = {
      attemptedCampaignKeys: ['campaign:first'],
      nextRoundAt: Date.now() + 30_000,
    };
    // When: Stop is requested.
    await stopFarmingSession(state, { onSaveTimingState: async () => {} });
    // Then: a later alarm cannot continue that round with stale authorization.
    expect(state.appState.queueAcquisitionRound).toBeNull();
    expect(state.appState.manualQueueAuthorized).toBe(false);
  });

  test('forgets a removed campaign before the user explicitly queues it again', () => {
    // Given: a campaign has exhausted its attempts in an ongoing round.
    const game = createGame({ campaignId: 'removed' });
    const state = createMinimalState();
    state.appState.queue = [game];
    state.appState.queueAcquisitionRound = {
      attemptedCampaignKeys: [gameKey(game)],
      nextRoundAt: Date.now() + 30_000,
    };
    // When: the user removes and explicitly adds the campaign again.
    removeGameFromQueue(state, game);
    pushGameToQueue(state, game);
    // Then: the explicit new queue entry is eligible for its initial turn.
    expect(prepareNextEligibleQueueHead(state, false)?.campaignId).toBe('removed');
  });

  test('preserves the acquisition round through weekend inactivity cleanup', async () => {
    // Given: authorized automatic resume has durable evidence of previous campaign attempts.
    const mocks = setupChromeMocks();
    const state = createMinimalState();
    state.appState.autoResumeOnStartup = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.queueAcquisitionRound = { attemptedCampaignKeys: ['campaign:first'], nextRoundAt: null };
    const expected = state.appState.queueAcquisitionRound;
    try {
      // When: the normal startup cleanup handles three days of inactivity.
      await resetStateForInactivity(
        state,
        'startup',
        72 * 3_600_000,
        {
          onStopMonitoring: () => {},
          onClearRotationMetadata: (app) => app,
          onResetStreamTrackingState: () => {},
          onSaveTimingState: async () => {},
          onBroadcastStateUpdate: () => {},
        },
        {
          createInitialState,
          DROPS_SNAPSHOT_CACHE_KEY: 'drops',
          LAST_ACTIVITY_AT_KEY: 'activity',
          TIMING_STATE_KEY: 'timing',
        },
      );
      // Then: cleanup cannot let expired cooldowns steal the untried campaign turns.
      expect(state.appState.queueAcquisitionRound).toEqual(expected);
      expect(state.appState.manualQueueAuthorized).toBe(true);
    } finally {
      mocks.teardown();
    }
  });

  test('removes parked campaigns whose absolute deadline expired during sleep', () => {
    // Given: a previously attempted campaign expired while another campaign remained eligible.
    const expired = createGame({ campaignId: 'expired', endsAt: '2000-01-01T00:00:00Z' });
    const available = createGame({ campaignId: 'available' });
    const state = createMinimalState();
    state.appState.queue = [expired, available];
    state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [gameKey(expired)], nextRoundAt: null };
    // When: the resumed queue chooses the next untried campaign.
    const next = prepareNextEligibleQueueHead(state, false);
    // Then: expired evidence is removed rather than kept as a permanently parked entry.
    expect(next?.campaignId).toBe('available');
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['available']);
    expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys ?? []).toEqual([]);
  });
});
