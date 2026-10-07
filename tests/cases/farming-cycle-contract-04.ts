import { expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../../src/background/drops-projection.ts';
import {
  FARMING_RECOVERY_RETRY_ALARM_NAME,
  reconcileFarmingRecoveryAlarm,
} from '../../src/background/farming-recovery-alarm.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import {
  reconcileFarmingSessionTargets,
  unresolvedFarmingTargets,
} from '../../src/background/farming-session-targets.ts';
import { QUEUE_ROUND_RETRY_MS } from '../../src/background/queue-acquisition-round.ts';
import { saveState } from '../../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../../src/shared/app-state-sync.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
} from '../fixtures/queue-management.ts';
import { chrome, fixture, NOW } from '../support/farming-cycle-contract.ts';
import { createQueueProgressionFixture } from '../support/queue-progression.ts';

test('progression parks a locally failed sole candidate without another directory attempt', async () => {
  const { state, game, key } = fixture();
  const next = createGame({ campaignId: 'next' });
  state.appState.queue = [game, next];
  state.appState.availableGames = [game, next];
  const transitions: string[] = [];
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [], nextRoundAt: NOW };
  const progression = createQueueProgressionFixture(state, {
    transitionCampaign: async (candidate) => {
      transitions.push(gameKey(candidate));
      if (gameKey(candidate) === key)
        return {
          kind: 'failed',
          reason: 'open-failed',
          failedStreamerName: 'only',
          alternativesExhausted: true,
          error: 'Unavailable playback',
        };
      state.appState.selectedGame = candidate;
      return { kind: 'started' };
    },
  });
  await progression.retryWaitingQueue();
  expect(transitions).toEqual([key, gameKey(next)]);
  expect(state.appState.selectedGame?.campaignId).toBe(next.campaignId);
  expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
});

test('persisted expiry ends the session even before Twitch validates the new worker generation', async () => {
  const { state, game } = fixture();
  const expired = { ...game, endsAt: new Date(NOW - 1).toISOString() };
  state.appState.selectedGame = expired;
  state.appState.queue = [expired];
  state.appState.availableGames = [expired];
  state.appState.farmingSessionTargets = {};
  state.hasCurrentGenerationCampaignValidation = false;
  const farming = createFarmingSession(state, createFarmingSessionAdapters());
  await farming.advanceQueueIfCompleted();
  expect(state.appState.isRunning).toBe(false);
  expect(state.appState.lastStopMessage).toContain('expired');
  expect(state.appState.farmingSessionTargets[gameKey(expired)]?.acquired).toBe(false);
});

test('a missing authorized target survives empty snapshots and a persisted worker restart', async () => {
  const { state, game } = fixture();
  projectDropsSnapshot(state, { games: [], drops: [], updatedAt: NOW }, 'campaign-authoritative');
  state.appState.queue = [];
  state.appState.selectedGame = null;
  await saveState(state);
  const restored = createMinimalState();
  restored.appState = normalizeStoredAppState(
    JSON.parse(JSON.stringify(chrome.storage.local._store.get('appState'))),
  );
  let starts = 0;
  const progression = createQueueProgressionFixture(restored, {
    transitionCampaign: async () => {
      starts++;
      return { kind: 'waiting' };
    },
  });
  restored.appState.queueAcquisitionRound = { attemptedCampaignKeys: [], nextRoundAt: NOW };
  await progression.retryWaitingQueue();
  expect(starts).toBe(1);
  expect(unresolvedFarmingTargets(restored)).toEqual([game]);
  expect(restored.appState.isRunning).toBe(true);
  expect(restored.appState.queueAcquisitionRound?.nextRoundAt).toBe(NOW + QUEUE_ROUND_RETRY_MS);
  await reconcileFarmingRecoveryAlarm(restored.appState);
  expect(await chrome.chrome.alarms.get(FARMING_RECOVERY_RETRY_ALARM_NAME)).toMatchObject({
    scheduledTime: NOW + QUEUE_ROUND_RETRY_MS,
  });
});

test.each(['missing', 'claim-failed', 'gated', 'future'] as const)(
  '%s rewards cannot produce automatic completion',
  async (kind) => {
    const { state, game } = fixture();
    const drop = createDrop({
      campaignId: game.campaignId,
      progress: 100,
      claimed: false,
      ...(kind === 'gated'
        ? ({ acquisitionMethod: 'subscription', rewardKind: 'twitch-badge' } as const)
        : {}),
      ...(kind === 'future' ? { startsAt: new Date(NOW + 60_000).toISOString() } : {}),
    });
    state.appState.allDrops = kind === 'missing' ? [] : [drop];
    state.appState.pendingDrops = state.appState.allDrops;
    state.cachedDropsSnapshot = state.appState.allDrops;
    await createQueueProgressionFixture(state, {
      transitionCampaign: async () => ({ kind: 'waiting' }),
    }).advanceIfCompleted();
    expect(state.appState.isRunning).toBe(true);
    expect(unresolvedFarmingTargets(state)).toHaveLength(1);
    expect(state.appState.lastStopReason).toBeNull();
  },
);

test.each(['acquired', 'expired', 'mixed'] as const)(
  'only verified %s targets end the session',
  async (kind) => {
    const { state, game } = fixture();
    const expired = { ...game, campaignId: 'expired', endsAt: new Date(NOW - 1).toISOString() };
    const acquired = {
      ...game,
      allDropsCompleted: true,
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] } as const,
    };
    state.appState.queue = kind === 'mixed' ? [acquired, expired] : [kind === 'expired' ? expired : acquired];
    state.appState.selectedGame = state.appState.queue[0] ?? null;
    state.appState.availableGames = state.appState.queue;
    state.appState.farmingSessionTargets = {};
    reconcileFarmingSessionTargets(state);
    await createQueueProgressionFixture(state, {
      transitionCampaign: async () => ({ kind: 'completed' }),
    }).advanceIfCompleted();
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('queue-complete');
    expect(state.appState.lastStopMessage).toContain(kind === 'acquired' ? 'acquired' : 'expired');
  },
);
