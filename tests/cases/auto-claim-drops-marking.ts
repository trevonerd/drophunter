import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { markDropClaimedInSnapshot, markDropClaimedLocally } from '../../src/background/auto-claim.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import { createMinimalState, makeDrop } from '../fixtures/auto-claim-drops.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerMarkDropClaimedLocallyCases() {
  describe('markDropClaimedLocally', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('marks drop as claimed in allDrops by claimId', () => {
      const drop = makeDrop({ claimId: 'claim-abc', id: 'drop-1', claimed: false, claimable: true });
      const state = createMinimalState({
        appState: {
          ...createInitialState(),
          selectedGame: { id: 'game-1', name: 'Test Game', imageUrl: '' },
          allDrops: [drop],
        },
        cachedDropsSnapshot: [],
      });

      const changed = markDropClaimedLocally(state, 'claim-abc');

      expect(changed).toBe(true);
      expect(state.appState.allDrops[0].claimed).toBe(true);
      expect(state.appState.allDrops[0].claimable).toBe(false);
      expect(state.appState.allDrops[0].progress).toBe(100);
      expect(state.appState.allDrops[0].remainingMinutes).toBe(0);
      expect(state.appState.allDrops[0].status).toBe('completed');
    });

    test('falls back to matching drop id when claimId does not match', () => {
      const drop = makeDrop({ claimId: undefined, id: 'drop-fallback', claimed: false, claimable: true });
      const state = createMinimalState({
        appState: {
          ...createInitialState(),
          selectedGame: { id: 'game-1', name: 'Test Game', imageUrl: '' },
          allDrops: [drop],
        },
        cachedDropsSnapshot: [],
      });

      const changed = markDropClaimedLocally(state, 'non-existent', 'drop-fallback');

      expect(changed).toBe(true);
      expect(state.appState.allDrops[0].claimed).toBe(true);
    });

    test('returns false when no drop matches', () => {
      const drop = makeDrop({ claimId: 'other-claim', id: 'drop-2' });
      const state = createMinimalState({ appState: { ...createInitialState(), allDrops: [drop] } });

      const changed = markDropClaimedLocally(state, 'unknown-claim');

      expect(changed).toBe(false);
    });
  });
}

export function registerMarkDropClaimedInSnapshotCases() {
  describe('markDropClaimedInSnapshot', () => {
    test('updates matching drop in cachedDropsSnapshot by claimId', () => {
      const drop = makeDrop({ claimId: 'snap-claim', id: 'snap-drop-1', claimed: false, claimable: true });
      const state = createMinimalState({ cachedDropsSnapshot: [drop] });

      markDropClaimedInSnapshot(state, 'snap-claim');

      expect(state.cachedDropsSnapshot[0].claimed).toBe(true);
      expect(state.cachedDropsSnapshot[0].claimable).toBe(false);
      expect(state.cachedDropsSnapshot[0].progress).toBe(100);
      expect(state.cachedDropsSnapshot[0].status).toBe('completed');
    });

    test('falls back to matching drop id when claimId does not match', () => {
      const drop = makeDrop({ claimId: undefined, id: 'snap-fallback', claimed: false, claimable: true });
      const state = createMinimalState({ cachedDropsSnapshot: [drop] });

      markDropClaimedInSnapshot(state, 'non-existent', 'snap-fallback');

      expect(state.cachedDropsSnapshot[0].claimed).toBe(true);
    });

    test('does nothing when no drop matches', () => {
      const drop = makeDrop({ claimId: 'other-snap', id: 'snap-other' });
      const state = createMinimalState({ cachedDropsSnapshot: [drop] });

      markDropClaimedInSnapshot(state, 'unknown-snap');

      expect(state.cachedDropsSnapshot[0].claimed).toBe(false);
    });
  });
}
