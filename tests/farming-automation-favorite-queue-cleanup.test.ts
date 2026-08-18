import { expect, test } from 'bun:test';
import { persistFarmingAutomationPlan } from '../src/background/farming-automation-effects.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { planFavoriteCampaignQueue } from '../src/background/favorite-games.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { CampaignCompletion, TwitchGame } from '../src/types/index.ts';

interface CampaignInput {
  readonly campaignId: string;
  readonly completion: CampaignCompletion;
  readonly endsAt: string;
}

function campaign({ campaignId, completion, endsAt }: CampaignInput): TwitchGame {
  return {
    id: 'marvel-rivals',
    name: 'Marvel Rivals',
    imageUrl: '',
    categoryId: 'marvel-rivals',
    campaignId,
    campaignName: campaignId,
    endsAt,
    rewardSummary: { completion, remainderReasons: [] },
  };
}

test('favorite queue cleanup persists when no new automatic campaign is added', async () => {
  // Given: one manual campaign plus terminal and redundant automatic siblings for the same favorite game.
  const state = createServiceWorkerState();
  const completedAuto = campaign({
    campaignId: 'campaign-completed-auto',
    completion: 'all-acquired',
    endsAt: '2030-08-01T00:00:00.000Z',
  });
  const redundantAuto = campaign({
    campaignId: 'campaign-redundant-auto',
    completion: 'farmable',
    endsAt: '2030-08-02T00:00:00.000Z',
  });
  const manual = campaign({
    campaignId: 'campaign-manual',
    completion: 'farmable',
    endsAt: '2030-08-16T00:00:00.000Z',
  });
  state.appState.availableGames = [completedAuto, redundantAuto, manual];
  state.appState.favoriteGames = [{ gameId: 'marvel-rivals', lastKnownName: 'Marvel Rivals', addedAt: 1 }];
  state.appState.campaignPriorityMode = 'priority-list-only';
  state.appState.queue = [completedAuto, redundantAuto, manual];
  state.appState.queueEntryMetadataByKey = {
    [gameKey(completedAuto)]: { source: 'favorite-auto', addedAt: 10, reason: 'favorite-discovered' },
    [gameKey(redundantAuto)]: { source: 'favorite-auto', addedAt: 11, reason: 'favorite-discovered' },
    [gameKey(manual)]: { source: 'manual', addedAt: 12, reason: 'user-added' },
  };
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  const plan = planFavoriteCampaignQueue(state.appState, 2_000);

  // When: the normal policy persistence boundary saves a cleanup-only plan.
  const persisted = await persistFarmingAutomationPlan({
    state,
    persistence,
    queuePlan: plan,
    availability: {},
    now: 2_000,
  });

  // Then: both live and durable state keep only the manual campaign and produce no fake addition activity.
  expect({
    persisted,
    added: plan.added,
    queue: state.appState.queue.map(gameKey),
    metadata: state.appState.queueEntryMetadataByKey,
    activity: state.appState.automationActivity,
    stored: storage.getLocal('appState'),
  }).toEqual({
    persisted: true,
    added: [],
    queue: [gameKey(manual)],
    metadata: {
      [gameKey(manual)]: { source: 'manual', addedAt: 12, reason: 'user-added' },
    },
    activity: [],
    stored: expect.objectContaining({
      queue: [manual],
      queueEntryMetadataByKey: {
        [gameKey(manual)]: { source: 'manual', addedAt: 12, reason: 'user-added' },
      },
    }),
  });
});
