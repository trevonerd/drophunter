import { expect, test } from 'bun:test';
import { planFarmingAutomationPolicy } from '../src/background/farming-automation-candidates.ts';
import { planFavoriteCampaignQueue } from '../src/background/favorite-games.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { campaign } from './support/farming-automation-queue-fixture.ts';

test('duplicate discovery rows create one queue transition', () => {
  // Given: the same campaign is returned twice in a favorite catalog.
  const state = createServiceWorkerState().appState;
  const game = campaign('favorite', '2030-08-03T00:00:00.000Z');
  state.availableGames = [game, { ...game }];
  state.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: 1 }];

  // When: favorite priority is applied to the batch.
  const plan = planFavoriteCampaignQueue(state, 2_000);

  // Then: exactly one insertion and one notification candidate are produced.
  expect(plan.queue.map(gameKey)).toEqual([gameKey(game)]);
  expect(plan.added).toHaveLength(1);
});

test('positive legacy completion overrides a contradictory farmable summary during ranking', () => {
  // Given: a persisted completion flag with an outdated summary and a live directory result.
  const state = createServiceWorkerState().appState;
  const game = { ...campaign('favorite', '2030-08-03T00:00:00.000Z'), allDropsCompleted: true };
  state.availableGames = [game];
  state.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: 1 }];
  state.campaignAvailabilityByKey = { [gameKey(game)]: { eligibleStreamerCount: 1, updatedAt: 1 } };

  // When: the pure policy ranks candidates.
  const plan = planFarmingAutomationPolicy(state, 2_000);

  // Then: priority cannot override either positive representation of completion.
  expect(plan.rankedCandidates).toEqual([]);
});
