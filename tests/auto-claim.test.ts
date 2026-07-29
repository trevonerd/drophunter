import { describe, expect, test } from 'bun:test';
import { markDropClaimedInSnapshot, markDropClaimedLocally } from '../src/background/auto-claim.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop } from '../src/types/index.ts';

function makeDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    claimId: 'claim-1',
    name: 'Test Drop',
    gameName: 'Test Game',
    gameId: 'game-1',
    imageUrl: '',
    campaignId: 'camp-1',
    progress: 100,
    currentMinutes: 60,
    claimed: false,
    claimable: true,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

describe('markDropClaimedLocally — campaign-aware fallback', () => {
  test('marks by claimId — returns true', () => {
    const state = createServiceWorkerState();
    // selectedGame must be set so splitDropsForSelectedGame preserves allDrops
    state.appState.selectedGame = { id: 'game-1', name: 'Test Game', imageUrl: '', campaignId: 'camp-1' };
    state.appState.allDrops = [makeDrop({ claimId: 'claim-1', campaignId: 'camp-1' })];
    const changed = markDropClaimedLocally(state, 'claim-1');
    expect(changed).toBe(true);
  });

  test('does not mark sibling campaign drop when falling back by id', () => {
    const state = createServiceWorkerState();
    // Use snapshot which is not filtered by selectedGame
    state.cachedDropsSnapshot = [
      makeDrop({ id: 'd1', claimId: undefined, campaignId: 'camp-1', claimed: false }),
      makeDrop({ id: 'd1', claimId: 'claim-2', campaignId: 'camp-2', claimed: false }),
    ];
    // allDrops for the mark call — no selectedGame so splitDrops will clear,
    // but we verify via snapshot that campaign scoping works
    state.appState.allDrops = [...state.cachedDropsSnapshot];
    markDropClaimedInSnapshot(state, 'claim-2', 'd1', 'camp-2');
    const camp1 = state.cachedDropsSnapshot.find((d) => d.campaignId === 'camp-1');
    const camp2 = state.cachedDropsSnapshot.find((d) => d.campaignId === 'camp-2');
    expect(camp1?.claimed).toBe(false);
    expect(camp2?.claimed).toBe(true);
  });

  test('returns false when nothing matches', () => {
    const state = createServiceWorkerState();
    state.appState.allDrops = [makeDrop({ claimId: 'other' })];
    expect(markDropClaimedLocally(state, 'claim-99')).toBe(false);
  });
});

describe('markDropClaimedInSnapshot — campaign-aware fallback', () => {
  test('does not mark sibling campaign drop in snapshot', () => {
    const state = createServiceWorkerState();
    state.cachedDropsSnapshot = [
      makeDrop({ id: 'd1', claimId: undefined, campaignId: 'camp-1', claimed: false }),
      makeDrop({ id: 'd1', claimId: 'claim-2', campaignId: 'camp-2', claimed: false }),
    ];
    markDropClaimedInSnapshot(state, 'claim-2', 'd1', 'camp-2');
    const camp1 = state.cachedDropsSnapshot.find((d) => d.campaignId === 'camp-1');
    const camp2 = state.cachedDropsSnapshot.find((d) => d.campaignId === 'camp-2');
    expect(camp1?.claimed).toBe(false);
    expect(camp2?.claimed).toBe(true);
  });
});
