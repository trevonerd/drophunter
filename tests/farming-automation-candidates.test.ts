import { describe, expect, test } from 'bun:test';
import {
  decideFarmingAutomationTransition,
  deriveFarmingAutomationCandidates,
  type FarmingAutomationCandidate,
  type FarmingAutomationPolicySnapshot,
  rankFarmingAutomationCandidates,
} from '../src/background/farming-automation-candidates.ts';
import { planFavoriteCampaignQueue } from '../src/background/favorite-games.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { QueueEntryMetadata, TwitchDrop, TwitchGame } from '../src/types/index.ts';

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
  test('manual queue order decides the next start while an earlier favorite can still preempt', () => {
    const incumbent = game('incumbent', '2030-08-05T12:00:00.000Z', 'incumbent-game');
    const manualFirst = game('manual-first', '2030-08-04T12:00:00.000Z', 'manual-game');
    const favorite = game('favorite', '2030-08-02T12:00:00.000Z');
    const snapshot = favoriteSnapshot([incumbent, manualFirst, favorite], {
      favoriteGames: [{ gameId: favorite.id, lastKnownName: favorite.name, addedAt: 1 }],
      manualQueueAuthorized: true,
      queue: [incumbent, manualFirst, favorite],
      queueEntryMetadataByKey: Object.fromEntries(
        [incumbent, manualFirst, favorite].map((entry) => [
          gameKey(entry),
          { source: 'manual', reason: 'user-added', addedAt: 1 } satisfies QueueEntryMetadata,
        ]),
      ),
    });
    const ranked = rankFarmingAutomationCandidates(snapshot, deriveFarmingAutomationCandidates(snapshot));
    expect(ranked.map((entry) => entry.game.campaignId)).toEqual(['incumbent', 'manual-first', 'favorite']);
    expect(
      decideFarmingAutomationTransition({
        isRunning: true,
        selectedGame: incumbent,
        rankedCandidates: ranked,
        lastPreemption: null,
      }),
    ).toEqual({ kind: 'preemption', campaign: favorite, fromCampaignKey: gameKey(incumbent) });
  });

  test('unclassified campaigns stay ineligible even when a pending reward is visible', () => {
    // Given: an unclassified campaign with a pending watch-time reward and an available streamer.
    const loading: TwitchGame = {
      id: 'same-game',
      name: 'Same Game',
      campaignId: 'campaign-loading',
      campaignName: 'Campaign loading',
      endsAt: '2030-08-03T12:00:00.000Z',
      imageUrl: '',
    };
    const pending: TwitchDrop = {
      id: 'reward-loading',
      name: 'Reward',
      gameId: loading.id,
      gameName: loading.name,
      imageUrl: '',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      campaignId: loading.campaignId,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    };
    const snapshot = favoriteSnapshot([loading], {
      allDrops: [pending],
      candidateFactsByKey: {
        [gameKey(loading)]: {
          hasFarmableReward: true,
          hasStartedReward: false,
          isActive: true,
        },
      },
    });

    // When: candidate policy derives and ranks the refreshed campaign.
    const candidates = deriveFarmingAutomationCandidates(snapshot, 20);
    const ranked = rankFarmingAutomationCandidates(snapshot, candidates);

    // Then: it waits for the authoritative campaign summary instead of speculating.
    expect({
      eligibility: candidates.map(({ hasFarmableReward, isActive }) => ({ hasFarmableReward, isActive })),
      ranked: ranked.map(({ game }) => game.campaignId),
    }).toEqual({
      eligibility: [{ hasFarmableReward: false, isActive: false }],
      ranked: [],
    });
  });

  test('plans every favorite campaign independently by deadline', () => {
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

  test('hidden categories never enter automatic queue planning or candidate ranking', () => {
    // Given: a favorite category that is also hidden by a later preference action.
    const hidden = game('campaign-hidden', '2030-08-03T12:00:00.000Z');
    const snapshot = favoriteSnapshot([hidden], {
      hiddenGames: [{ gameId: 'same-game', lastKnownName: 'Same Game', hiddenAt: 10 }],
    });

    // When: the automation policy derives and ranks the refreshed campaigns.
    const plan = planFavoriteCampaignQueue(snapshot, 20);
    const candidates = deriveFarmingAutomationCandidates(snapshot, 20);
    const ranked = rankFarmingAutomationCandidates(snapshot, candidates);

    // Then: hidden campaigns are absent from every future automatic decision.
    expect(plan.queue).toEqual([]);
    expect(candidates).toEqual([]);
    expect(ranked).toEqual([]);
  });

  test('hidden categories do not alter the underlying available snapshot', () => {
    // Given: visible and hidden campaigns from distinct categories.
    const visible = game('campaign-visible', '2030-08-03T12:00:00.000Z', 'visible-game');
    const hidden = game('campaign-hidden', '2030-08-03T13:00:00.000Z', 'hidden-game');
    const snapshot = favoriteSnapshot([visible, hidden], {
      hiddenGames: [{ gameId: 'hidden-game', lastKnownName: 'Same Game', hiddenAt: 10 }],
    });

    // When: candidate derivation applies hidden filtering.
    deriveFarmingAutomationCandidates(snapshot, 20);

    // Then: only the derived decision set changes; Twitch's source snapshot remains intact.
    expect(snapshot.availableGames).toEqual([visible, hidden]);
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

  test('normalizes retired priority modes to the shared favorite deadline policy', () => {
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
    const plan = planFavoriteCampaignQueue(snapshot, 20);
    const ranked = rankFarmingAutomationCandidates(snapshot, deriveFarmingAutomationCandidates(snapshot));

    expect(plan.queue.map((candidate) => candidate.campaignId)).toEqual([
      'campaign-b',
      'campaign-a',
      'manual',
    ]);
    expect(plan.queueEntryMetadataByKey[gameKey(first)]?.source).toBe('favorite-auto');
    expect(ranked.map((candidate) => candidate.game.campaignId)).toEqual(['campaign-b', 'campaign-a']);
  });

  test('preempts the active campaign when a favorite candidate expires earlier', () => {
    const earlier = game('earlier', '2030-08-03T12:00:00.000Z');
    const active = game('active', '2030-08-04T12:00:00.000Z');
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
        selectedGame: active,
        lastPreemption: null,
        rankedCandidates: [candidate(earlier, true)],
      }),
    ).toEqual({
      kind: 'preemption',
      campaign: earlier,
      fromCampaignKey: gameKey(active),
    });
  });
});

describe('Preemption deadline ties and explicit Play priority', () => {
  const candidate = (
    entry: TwitchGame,
    flags: Partial<
      Pick<FarmingAutomationCandidate, 'isFavorite' | 'isManualPriority' | 'eligibleStreamerCount'>
    > = {},
  ): FarmingAutomationCandidate => ({
    game: entry,
    eligibleStreamerCount: 1,
    hasStartedReward: false,
    hasFarmableReward: true,
    isActive: true,
    isFavorite: false,
    ...flags,
  });
  const incumbent = game('incumbent', '2030-08-03T12:00:00.000Z');
  const decide = (ranked: FarmingAutomationCandidate[], incumbentIsFavorite: boolean) =>
    decideFarmingAutomationTransition({
      isRunning: true,
      selectedGame: incumbent,
      incumbentIsFavorite,
      rankedCandidates: ranked,
      lastPreemption: null,
    });

  test('favorite beats a non-favorite incumbent ending later the same day', () => {
    const favorite = game('favorite', '2030-08-03T20:00:00.000Z');
    expect(decide([candidate(favorite, { isFavorite: true })], false)).toEqual({
      kind: 'preemption',
      campaign: favorite,
      fromCampaignKey: gameKey(incumbent),
    });
  });

  test('favorite does not preempt a favorite incumbent ending the same day but later', () => {
    const favorite = game('favorite', '2030-08-03T20:00:00.000Z');
    expect(decide([candidate(favorite, { isFavorite: true })], true).kind).toBe('unchanged');
  });

  test('favorite preempts a non-favorite incumbent even when it ends later', () => {
    const favorite = game('favorite', '2030-08-10T12:00:00.000Z');
    expect(decide([candidate(favorite, { isFavorite: true })], false).kind).toBe('preemption');
  });

  test('explicit Play of a non-favorite never displaces a favorite incumbent', () => {
    const played = game('played', '2030-08-03T10:00:00.000Z');
    expect(decide([candidate(played, { isManualPriority: true })], true).kind).toBe('unchanged');
  });

  test('explicit queued Play resumes once streamers return, even against a favorite incumbent', () => {
    const played = game('played', '2030-08-03T20:00:00.000Z');
    expect(decide([candidate(played, { isFavorite: true, isManualPriority: true })], true)).toEqual({
      kind: 'preemption',
      campaign: played,
      fromCampaignKey: gameKey(incumbent),
    });
  });

  test('explicit queued Play waits while it still has no eligible streamer', () => {
    const played = game('played', '2030-08-03T20:00:00.000Z');
    expect(decide([candidate(played, { isManualPriority: true, eligibleStreamerCount: 0 })], true).kind).toBe(
      'unchanged',
    );
  });

  test('candidates derive explicit Play priority from queue metadata', () => {
    const played = game('played', '2030-08-03T20:00:00.000Z');
    const metadata: QueueEntryMetadata = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      manualPriorityAt: 1,
    };
    const [derived] = deriveFarmingAutomationCandidates(
      favoriteSnapshot([played], { queueEntryMetadataByKey: { [gameKey(played)]: metadata } }),
      Date.parse('2030-08-01T00:00:00.000Z'),
    );
    expect(derived?.isManualPriority).toBe(true);
  });
});
