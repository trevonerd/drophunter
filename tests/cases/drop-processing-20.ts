import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing20(): void {
  describe('subject.splitDropsForSelectedGame', () => {
    test('campaign with all farmable drops claimed has no pending drops or currentDrop', () => {
      const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
      const drops = [
        {
          id: 'd1',
          name: 'Claimed Reward A',
          gameId: 'g1',
          gameName: 'IL',
          imageUrl: '',
          progress: 100,
          currentMinutes: 60,
          claimed: true,
          claimable: false,
          campaignId: 'c1',
          requiredMinutes: 60,
          remainingMinutes: 0,
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        },
        {
          id: 'd2',
          name: 'Claimed Reward B',
          gameId: 'g1',
          gameName: 'IL',
          imageUrl: '',
          progress: 100,
          currentMinutes: 120,
          claimed: true,
          claimable: false,
          campaignId: 'c1',
          requiredMinutes: 120,
          remainingMinutes: 0,
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        },
      ] as subject.TwitchDrop[];

      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
        },
      });

      subject.splitDropsForSelectedGame(state, drops);

      expect(state.appState.completedDrops).toHaveLength(2);
      expect(state.appState.pendingDrops).toHaveLength(0);
      expect(state.appState.currentDrop).toBeNull();
    });

    test('no strict matches triggers relaxed fallback (drops with name overlap)', () => {
      const selected = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
      const fallback = {
        id: 'd1',
        name: 'Drop',
        gameId: 'g1',
        gameName: 'Destiny 2',
        imageUrl: '',
        progress: 20,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } as subject.TwitchDrop;

      const state = subject.makeState({
        appState: { ...subject.createInitialState(), selectedGame: selected },
      });

      subject.splitDropsForSelectedGame(state, [fallback]);

      expect(state.appState.allDrops.length).toBeGreaterThan(0);
    });

    test('clears recovery state when tracked drop progress advances', () => {
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '', campaignId: 'c1' };
      const previousDrop = {
        id: 'd1',
        name: 'Drop A',
        gameId: 'g1',
        gameName: 'Destiny 2',
        imageUrl: '',
        progress: 20,
        currentMinutes: 20,
        claimed: false,
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } as subject.TwitchDrop;
      const nextDrop = {
        ...previousDrop,
        progress: 25,
        currentMinutes: 25,
      };
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
          recoveryReason: 'stalled-progress',
          recoveryBackoffUntil: Date.now() + 60_000,
          recoveryAttempts: 2,
          allDrops: [previousDrop],
        },
        lastTrackedDropKey: 'd1::c1',
        lastTrackedProgress: 20,
        lastTrackedMinutes: 20,
        lastProgressAdvanceAt: Date.now() - 10 * 60_000,
        noProgressRotationAttempts: 3,
        recoveryBackoffUntil: Date.now() + 60_000,
        lastRecoveryAttemptAt: Date.now() - 60_000,
        stalledRecoveryAttempts: 2,
        recoveryNotificationSent: true,
      });

      subject.splitDropsForSelectedGame(state, [nextDrop], true);

      expect(state.lastTrackedProgress).toBe(25);
      expect(state.noProgressRotationAttempts).toBe(0);
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.recoveryBackoffUntil).toBe(0);
      expect(state.recoveryNotificationSent).toBe(false);
      expect(state.appState.recoveryReason).toBeNull();
    });
  });
}
