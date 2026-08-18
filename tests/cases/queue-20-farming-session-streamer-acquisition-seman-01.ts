import { describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from '../fixtures/queue-management.ts';

export function registerQueue20Part01() {
  describe('farming session streamer acquisition semantics', () => {
    async function runFarmingSessionStreamerAcquisition(rewardOverrides: Partial<TwitchDrop>) {
      const state = createMinimalState();
      const game = createGame({ campaignId: 'native-campaign', categorySlug: 'native-game' });
      const reward = createDrop({
        campaignId: game.campaignId,
        categorySlug: game.categorySlug,
        ...rewardOverrides,
      });
      state.appState.selectedGame = game;
      state.cachedDropsSnapshot = [reward];
      let fetchCalls = 0;
      const openedStreamers: string[] = [];
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          fetchDirectoryStreamersFromApi: async () => {
            fetchCalls += 1;
            return Object.assign([createStreamer()], { languageFilterApplied: false });
          },
          openForegroundChannel: async (streamer) => {
            openedStreamers.push(streamer.name);
          },
        }),
      );

      const opened = await session.acquireStreamerForSelectedGame();
      return { opened, fetchCalls, openedStreamers };
    }

    test('opens a streamer for a 100%-progress Twitch-native reward without verified acquisition', async () => {
      // Given: Twitch reports full progress for a native reward but no strict award proof.
      const reward = {
        progress: 100,
        currentMinutes: 60,
        requiredMinutes: 60,
        remainingMinutes: 0,
        claimable: false,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      } satisfies Partial<TwitchDrop>;

      // When: the production farming-session seam acquires a streamer.
      const result = await runFarmingSessionStreamerAcquisition(reward);

      // Then: the still-unacquired native reward reaches directory fetch and opens.
      expect(result).toEqual({
        opened: true,
        fetchCalls: 1,
        openedStreamers: ['streamer-1'],
      });
    });

    test('suppresses streamer acquisition for a verified Twitch-native reward', async () => {
      // Given: strict Twitch evidence verifies the native reward acquisition.
      const reward = {
        progress: 100,
        currentMinutes: 60,
        requiredMinutes: 60,
        remainingMinutes: 0,
        claimable: false,
        rewardKind: 'twitch-emote',
        verificationState: 'verified',
      } satisfies Partial<TwitchDrop>;

      // When: the production farming-session seam acquires a streamer.
      const result = await runFarmingSessionStreamerAcquisition(reward);

      // Then: an acquired native reward never reaches directory fetch.
      expect(result).toEqual({ opened: false, fetchCalls: 0, openedStreamers: [] });
    });

    test('preserves streamer suppression for an ordinary completed reward', async () => {
      // Given: an ordinary in-game reward is complete under the existing progress rule.
      const reward = {
        progress: 100,
        currentMinutes: 60,
        requiredMinutes: 60,
        remainingMinutes: 0,
        claimable: false,
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies Partial<TwitchDrop>;

      // When: the production farming-session seam acquires a streamer.
      const result = await runFarmingSessionStreamerAcquisition(reward);

      // Then: ordinary completed behavior remains suppressed.
      expect(result).toEqual({ opened: false, fetchCalls: 0, openedStreamers: [] });
    });
  });
}
