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

    test('parks an identified Twitch-native campaign at 99 percent without changing its reward evidence', async () => {
      const { game, state } = createExhaustedRecoveryFixture({ progress: 99, currentMinutes: 59 });
      await createStalledRecoverySession(state).checkDropProgress();

      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.pendingDrops[0]?.progress).toBe(99);
      expect(state.appState.pendingDrops[0]?.verificationState).toBe('unassessed');
      const block = state.appState.stalledCampaignBlocksByKey['campaign:native-campaign'];
      expect(typeof block?.blockedAt).toBe('number');
      expect(block?.rotationAttempts).toBe(3);
      expect(block?.eligibleStreamerNames).toEqual([]);
      expect(block?.rewardProgressByKey).toEqual({
        'native-reward::native-campaign': { progress: 99, currentMinutes: 59 },
      });
      expect(state.appState.queue.map((queuedGame) => queuedGame.campaignId)).toEqual([game.campaignId]);
      expect(state.appState.lastStopReason).toBe('stall-skipped');
    });

    test('preserves exact zero-percent progress when third-attempt recovery blocks the campaign', async () => {
      const { state } = createExhaustedRecoveryFixture({ progress: 0, currentMinutes: 0 });
      await createStalledRecoverySession(state).checkDropProgress();

      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.pendingDrops[0]?.progress).toBe(0);
      expect(state.appState.pendingDrops[0]?.currentMinutes).toBe(0);
      expect(state.appState.pendingDrops[0]?.verificationState).toBe('unassessed');
      expect(state.appState.stalledCampaignBlocksByKey['campaign:native-campaign']).toBeDefined();
      expect(state.appState.lastStopReason).toBe('stall-skipped');
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

    test('does not reacquire a blocked mixed campaign merely because another reward remains', async () => {
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
      const { state } = createExhaustedRecoveryFixture({
        progress: 99,
        currentMinutes: 59,
        additionalDrops: [nextReward],
      });
      let reacquireCalls = 0;

      await createStalledRecoverySession(state, {
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([createStreamer({ id: 'replacement', name: 'replacement' })], {
            languageFilterApplied: true,
          }),
        openForegroundChannel: async () => {
          reacquireCalls += 1;
        },
      }).checkDropProgress();

      expect(reacquireCalls).toBe(0);
      expect(state.appState.currentDrop?.id).toBe('native-reward');
      expect(state.appState.pendingDrops.find((drop) => drop.id === 'native-reward')?.verificationState).toBe(
        'unassessed',
      );
      expect(state.appState.stalledCampaignBlocksByKey['campaign:native-campaign']).toBeDefined();
      expect(state.appState.lastStopReason).toBe('stall-skipped');
    });
  });
}
