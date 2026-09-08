import { expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
} from '../src/background/twitch-api/claimed-rewards.ts';
import { buildInventoryDropMaps } from '../src/background/twitch-api/inventory-drops.ts';
import {
  composeDropsSnapshot,
  type SnapshotCompositionContext,
} from '../src/background/twitch-api/snapshot-composition.ts';

function fixture(shared = true, namedGame = false) {
  const campaigns = ['a', 'b'].map((id) => ({
    id,
    name: `Campaign ${id}`,
    game: { id, name: `Game ${id}` },
    startAt: '2026-09-01T00:00:00Z',
    endAt: '2026-10-01T00:00:00Z',
    timeBasedDrops: [],
  }));
  const inventory = {
    dropCampaignsInProgress: [],
    gameEventDrops: [
      {
        id: 'shared',
        game: namedGame ? { name: 'Game a' } : null,
        lastAwardedAt: '2026-09-08T10:00:00Z',
      },
    ],
  };
  const details = (id: string): Record<string, unknown> => ({
    timeBasedDrops: [
      {
        id: `drop-${id}`,
        name: 'Badge',
        requiredMinutesWatched: 60,
        benefitEdges: [
          { benefit: { id: shared || id === 'a' ? 'shared' : 'different', distributionType: 'BADGE' } },
        ],
      },
    ],
  });
  const context: SnapshotCompositionContext = {
    campaigns,
    usableCampaigns: campaigns,
    dashboardCampaignIds: ['a', 'b'],
    inventoryVerified: true,
    inventoryMaps: buildInventoryDropMaps(inventory),
    claimedRewards: buildClaimedRewardLookup(inventory),
    globalClaimedRewards: buildGlobalClaimedRewardEntry(inventory),
  };
  const partial = new Map([['a', details('a')]]);
  const complete = new Map([
    ['a', details('a')],
    ['b', details('b')],
  ]);
  return { context, partial, complete };
}

test('progressive campaign details cannot prove a game-less badge benefit is globally unique', () => {
  const { context, partial } = fixture();
  const snapshot = composeDropsSnapshot(context, partial);
  expect(snapshot.drops[0]).toMatchObject({ claimed: false, verificationState: 'unassessed' });
});

test('a later conflicting campaign cannot leave an earlier partial native claim stuck in projection', () => {
  const { context, partial, complete } = fixture();
  const first = composeDropsSnapshot(context, partial);
  const state = createServiceWorkerState();
  state.appState.selectedGame = first.games[0] ?? null;
  projectDropsSnapshot(state, first, 'inventory-partial');
  projectDropsSnapshot(state, composeDropsSnapshot(context, complete, true), 'campaign-authoritative');
  expect(state.appState.allDrops[0]).toMatchObject({ claimed: false, verificationState: 'unassessed' });
  expect(state.appState.currentDrop?.id).toBe('drop-a');
});

test('complete unique campaign details accept a timestamped game-less native award', () => {
  const { context, complete } = fixture(false);
  expect(composeDropsSnapshot(context, complete, true).drops[0]).toMatchObject({
    claimed: true,
    verificationState: 'verified',
  });
});

test('named-game evidence remains usable during progressive details discovery', () => {
  const { context, partial } = fixture(false, true);
  expect(composeDropsSnapshot(context, partial).drops[0]).toMatchObject({
    claimed: true,
    verificationState: 'verified',
  });
});
