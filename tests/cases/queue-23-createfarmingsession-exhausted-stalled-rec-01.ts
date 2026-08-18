import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createDrop,
  createExhaustedRecoveryFixture,
  createStalledRecoverySession,
  createStreamer,
} from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue23Part01() {
  describe('createFarmingSession exhausted stalled recovery', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
      chrome.alarms.clear = async () => true;
      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/stalled-streamer' });
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('marks an identified Twitch-native reward at 99 percent before terminal queue mutation', async () => {
      const realDateNow = Date.now;
      const now = realDateNow();
      Date.now = () => now;
      const { game, state } = createExhaustedRecoveryFixture({ progress: 99, currentMinutes: 59 });
      const events: string[] = [];
      let markerRecorded = false;
      let reprojectRecorded = false;
      let queueMutationRecorded = false;

      try {
        const session = createStalledRecoverySession(state, {
          saveTimingState: async (nextState) => {
            if (!markerRecorded && Object.keys(nextState.unverifiableRewardsByKey).length === 1) {
              markerRecorded = true;
              events.push('marker-save');
              expect(nextState.appState.queue.map((queuedGame) => queuedGame.campaignId)).toEqual([
                game.campaignId,
              ]);
            }
          },
          saveState: async (nextState) => {
            if (
              markerRecorded &&
              !reprojectRecorded &&
              nextState.appState.currentDrop === null &&
              nextState.appState.queue.length === 1
            ) {
              reprojectRecorded = true;
              events.push('reproject');
            }
            if (markerRecorded && !queueMutationRecorded && nextState.appState.queue.length === 0) {
              queueMutationRecorded = true;
              events.push('queue-mutation');
            }
          },
        });

        await session.checkDropProgress();

        expect(events.slice(0, 3)).toEqual(['marker-save', 'reproject', 'queue-mutation']);
        expect(Object.values(state.unverifiableRewardsByKey)).toEqual([
          { progress: 99, currentMinutes: 59, markedAt: now },
        ]);
        expect(state.appState.pendingDrops[0]?.progress).toBe(99);
        expect(state.appState.pendingDrops[0]?.verificationState).toBe('unverifiable');
        expect(state.appState.availableGames[0]?.rewardSummary).toEqual({
          completion: 'farming-complete',
          remainderReasons: ['unverifiable-twitch'],
        });
        expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
        expect(state.appState.lastStopMessage).not.toMatch(/all rewards (claimed|acquired|complete)/i);
      } finally {
        Date.now = realDateNow;
      }
    });

    test('preserves exact zero-percent progress when third-attempt recovery becomes unverifiable', async () => {
      const realDateNow = Date.now;
      const now = realDateNow();
      Date.now = () => now;
      const { state } = createExhaustedRecoveryFixture({ progress: 0, currentMinutes: 0 });

      try {
        await createStalledRecoverySession(state).checkDropProgress();

        expect(Object.values(state.unverifiableRewardsByKey)).toEqual([
          { progress: 0, currentMinutes: 0, markedAt: now },
        ]);
        expect(state.appState.pendingDrops[0]?.progress).toBe(0);
        expect(state.appState.pendingDrops[0]?.currentMinutes).toBe(0);
        expect(state.appState.pendingDrops[0]?.verificationState).toBe('unverifiable');
        expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
      } finally {
        Date.now = realDateNow;
      }
    });

    test('does not mark a Twitch-native reward during the first recovery attempt', async () => {
      const { game, state } = createExhaustedRecoveryFixture({ progress: 99, currentMinutes: 59 });
      state.stalledRecoveryAttempts = 0;
      state.appState.recoveryAttempts = null;
      let selfHealCalls = 0;

      await createStalledRecoverySession(state, {
        attemptPlaybackSelfHeal: async () => {
          selfHealCalls += 1;
        },
      }).checkDropProgress();

      expect(selfHealCalls).toBe(1);
      expect(state.stalledRecoveryAttempts).toBe(1);
      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    });

    test('keeps the ordinary stalled-progress path when campaign identity is blank', async () => {
      const { state } = createExhaustedRecoveryFixture({
        progress: 99,
        currentMinutes: 59,
        campaignId: '   ',
      });

      await createStalledRecoverySession(state).checkDropProgress();

      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.lastStopReason).toBe('stall-skipped');
      expect(state.appState.lastStopMessage).toContain('drop progress did not resume');
    });

    for (const rewardKind of ['in-game', 'unknown'] as const) {
      test(`keeps ${rewardKind} rewards on the ordinary third-attempt stall path`, async () => {
        const { state } = createExhaustedRecoveryFixture({
          progress: 99,
          currentMinutes: 59,
          rewardKind,
        });

        await createStalledRecoverySession(state).checkDropProgress();

        expect(state.unverifiableRewardsByKey).toEqual({});
        expect(state.appState.lastStopReason).toBe('stall-skipped');
        expect(state.appState.lastStopMessage).toContain('drop progress did not resume');
      });
    }

    test('reprojects and reacquires the same mixed campaign when another automatable reward remains', async () => {
      const nextReward = createDrop({
        id: 'next-reward',
        gameId: 'native-game',
        gameName: 'Native Game',
        campaignId: 'native-campaign',
        categorySlug: 'native-game',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      });
      const { game, nativeReward, state } = createExhaustedRecoveryFixture({
        progress: 99,
        currentMinutes: 59,
        additionalDrops: [nextReward],
      });
      const events: string[] = [];
      let markerRecorded = false;
      let reprojectRecorded = false;

      await createStalledRecoverySession(state, {
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([createStreamer({ id: 'replacement', name: 'replacement' })], {
            languageFilterApplied: true,
          }),
        openForegroundChannel: async () => {
          events.push('reacquire');
        },
        saveTimingState: async (nextState) => {
          if (!markerRecorded && Object.keys(nextState.unverifiableRewardsByKey).length === 1) {
            markerRecorded = true;
            events.push('marker-save');
          }
        },
        saveState: async (nextState) => {
          if (markerRecorded && !reprojectRecorded && nextState.appState.currentDrop?.id === nextReward.id) {
            reprojectRecorded = true;
            events.push('reproject');
          }
        },
      }).checkDropProgress();

      expect(events.slice(0, 3)).toEqual(['marker-save', 'reproject', 'reacquire']);
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(state.appState.queue.map((queuedGame) => queuedGame.campaignId)).toEqual([game.campaignId]);
      expect(state.appState.currentDrop?.id).toBe(nextReward.id);
      expect(state.appState.pendingDrops.find((drop) => drop.id === nativeReward.id)?.verificationState).toBe(
        'unverifiable',
      );
      expect(state.appState.lastStopReason).toBeNull();
    });
  });
}
