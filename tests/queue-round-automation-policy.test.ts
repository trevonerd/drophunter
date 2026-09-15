import { describe, expect, test } from 'bun:test';
import {
  deriveFarmingAutomationCandidates,
  type FarmingAutomationPolicySnapshot,
  rankFarmingAutomationCandidates,
} from '../src/background/farming-automation-candidates.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createGame } from './fixtures/queue-management.ts';

describe('queue round automation policy', () => {
  test('ranks an authorized earlier manual campaign before a later favorite', () => {
    // Given: manual and favorite campaigns are both live, with the manual campaign ending first.
    const manual = createGame({
      id: 'manual-game',
      campaignId: 'manual',
      endsAt: '2030-01-01T00:00:00Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const favorite = createGame({
      id: 'favorite-game',
      campaignId: 'favorite',
      endsAt: '2030-01-02T00:00:00Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const snapshot: FarmingAutomationPolicySnapshot = {
      availableGames: [manual, favorite],
      queue: [manual, favorite],
      manualQueueAuthorized: true,
      favoriteGames: [{ gameId: 'favorite-game', lastKnownName: favorite.name, addedAt: 1 }],
      queueEntryMetadataByKey: { [gameKey(manual)]: { source: 'manual', addedAt: 1, reason: 'user-added' } },
      campaignAvailabilityByKey: Object.fromEntries(
        [manual, favorite].map((game) => [gameKey(game), { eligibleStreamerCount: 1, updatedAt: 1 }]),
      ),
      campaignPriorityMode: 'ending-soonest',
      farmCategoryScope: 'all',
    };
    // When: automation ranks the same queue as the foreground farming session.
    const ranked = rankFarmingAutomationCandidates(snapshot, deriveFarmingAutomationCandidates(snapshot, 1));
    // Then: favorite status does not override the earlier deadline.
    expect(ranked.map(({ game }) => game.campaignId)).toEqual(['manual', 'favorite']);
  });
});
