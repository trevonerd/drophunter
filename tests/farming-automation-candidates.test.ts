import { describe, expect, test } from 'bun:test';
import {
  decideFarmingAutomationTransition,
  deriveFarmingAutomationCandidates,
  type FarmingAutomationCandidate,
  type FarmingAutomationPolicySnapshot,
  planFavoriteCampaignQueue,
  rankFarmingAutomationCandidates,
} from '../src/background/farming-automation-candidates.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { QueueEntryMetadata, TwitchGame } from '../src/types/index.ts';

function game(campaignId: string, endsAt: string, gameId = 'same-game'): TwitchGame {
  return {
    id: gameId,
    name: 'Same Game',
    campaignId,
    campaignName: campaignId,
    endsAt,
    imageUrl: '',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function favoriteSnapshot(
  games: readonly TwitchGame[],
  overrides: Partial<FarmingAutomationPolicySnapshot> = {},
): FarmingAutomationPolicySnapshot {
  return {
    availableGames: games,
    campaignAvailabilityByKey: Object.fromEntries(
      games.map((entry) => [gameKey(entry), { eligibleStreamerCount: 1, updatedAt: 1 }]),
    ),
    favoriteGames: [{ gameId: 'same-game', lastKnownName: 'Same Game', addedAt: 1 }],
    queue: [],
    queueEntryMetadataByKey: {},
    campaignPriorityMode: 'priority-list-only',
    farmCategoryScope: 'all',
    ...overrides,
  };
}

describe('farming automation candidate policy', () => {
  test('plans favorite-auto entries by campaign identity', () => {
    const first = game('campaign-a', '2030-08-03T14:00:00.000Z');
    const second = game('campaign-b', '2030-08-03T12:00:00.000Z');
    const manual = game('manual', '2030-08-03T18:00:00.000Z', 'manual-game');
    const manualMetadata: QueueEntryMetadata = {
      source: 'manual',
      addedAt: 3,
      reason: 'user-added',
    };
    const snapshot = favoriteSnapshot([first, second], {
      queue: [manual],
      queueEntryMetadataByKey: { [gameKey(manual)]: manualMetadata },
    });

    const plan = planFavoriteCampaignQueue(snapshot, 20);

    expect(plan.queue.map((entry) => gameKey(entry))).toEqual([
      gameKey(second),
      gameKey(first),
      gameKey(manual),
    ]);
    expect(plan.queueEntryMetadataByKey[gameKey(manual)]).toEqual(manualMetadata);
    expect(plan.queueEntryMetadataByKey[gameKey(first)]?.source).toBe('favorite-auto');
    expect(plan.queueEntryMetadataByKey[gameKey(second)]?.source).toBe('favorite-auto');
    expect(plan.added.map((entry) => gameKey(entry.game))).toEqual([gameKey(second), gameKey(first)]);
  });

  test('derives duplicate game ids with independent campaign availability', () => {
    const first = game('campaign-a', '2030-08-03T14:00:00.000Z');
    const second = game('campaign-b', '2030-08-03T12:00:00.000Z');
    const snapshot = favoriteSnapshot([first, second], {
      campaignAvailabilityByKey: {
        [gameKey(first)]: { eligibleStreamerCount: 4, updatedAt: 1 },
        [gameKey(second)]: { eligibleStreamerCount: 1, updatedAt: 1 },
      },
    });

    const candidates = deriveFarmingAutomationCandidates(snapshot);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.game.campaignId)).toEqual(['campaign-a', 'campaign-b']);
    expect(candidates.map((candidate) => candidate.eligibleStreamerCount)).toEqual([4, 1]);
    expect(new Set(candidates.map((candidate) => gameKey(candidate.game))).size).toBe(2);
  });

  test('keeps private modes byte-for-byte immutable', () => {
    const first = game('campaign-a', '2030-08-03T14:00:00.000Z');
    const second = game('campaign-b', '2030-08-03T12:00:00.000Z');
    const manual = game('manual', '2030-08-03T18:00:00.000Z', 'manual-game');
    const snapshot = favoriteSnapshot([first, second], {
      queue: [manual],
      queueEntryMetadataByKey: {
        [gameKey(manual)]: { source: 'manual', addedAt: 3, reason: 'user-added' },
      },
      campaignPriorityMode: 'ending-soonest',
    });
    const before = JSON.stringify({ queue: snapshot.queue, metadata: snapshot.queueEntryMetadataByKey });

    const plan = planFavoriteCampaignQueue(snapshot, 20);
    const ranked = rankFarmingAutomationCandidates(snapshot, deriveFarmingAutomationCandidates(snapshot));

    expect(JSON.stringify({ queue: plan.queue, metadata: plan.queueEntryMetadataByKey })).toBe(before);
    expect(ranked.map((candidate) => candidate.game.campaignId)).toEqual(['campaign-b', 'campaign-a']);
  });

  test('preempts only a favorite with a finite strictly earlier expiry', () => {
    const current = game('current', '2030-08-03T14:00:00.000Z');
    const earlier = game('earlier', '2030-08-03T12:00:00.000Z');
    const later = game('later', '2030-08-03T16:00:00.000Z');
    const candidate = (campaign: TwitchGame, isFavorite: boolean): FarmingAutomationCandidate => ({
      game: campaign,
      eligibleStreamerCount: 1,
      hasStartedReward: false,
      hasFarmableReward: true,
      isActive: true,
      isFavorite,
    });

    expect(
      decideFarmingAutomationTransition({
        isRunning: true,
        currentCampaign: current,
        rankedCandidates: [candidate(earlier, true)],
      }),
    ).toEqual({ kind: 'preempt', campaign: earlier, currentCampaign: current });
    expect(
      decideFarmingAutomationTransition({
        isRunning: true,
        currentCampaign: current,
        rankedCandidates: [candidate(later, true)],
      }).kind,
    ).toBe('unchanged');
    expect(
      decideFarmingAutomationTransition({
        isRunning: true,
        currentCampaign: current,
        rankedCandidates: [candidate(earlier, false)],
      }).kind,
    ).toBe('unchanged');
  });
});
