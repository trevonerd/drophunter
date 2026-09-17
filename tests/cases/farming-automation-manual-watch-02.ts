import { expect, test } from 'bun:test';
import { createFarmingAutomationManualWatch } from '../../src/background/farming-automation-manual-watch.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../../src/background/farming-automation-persistence.ts';
import { observeManualPlayback } from '../../src/background/playback-orchestrator.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { TwitchGame } from '../../src/types/index.ts';

const target: TwitchGame = {
  id: 'game-1',
  name: 'Game 1',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game-1',
  allowedChannels: ['manual-channel'],
};

test('resumes transport as soon as a playing personal stream disappears', async () => {
  // Given: transport is suspended for a confirmed background personal stream.
  const state = createServiceWorkerState();
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => 'session-1',
    broadcast: () => undefined,
  });
  let currentTime = 1_000;
  let manualPlaybackActive = true;
  const createController = () =>
    createFarmingAutomationManualWatch({
      persistence,
      observeManualTabs: async () => {
        if (!manualPlaybackActive) {
          return observeManualPlayback(
            { query: async () => [{ id: 4, active: true, url: 'https://www.twitch.tv/drops/campaigns' }] },
            async () => null,
          );
        }
        return {
          kind: 'observed' as const,
          tabs: [
            {
              tab: { id: 4, active: false, url: 'https://www.twitch.tv/manual-channel' },
              context: {
                channelName: 'manual-channel',
                categorySlug: 'game-1',
                isLive: true,
                isPlaybackReady: true,
                hasDropsEnabled: true,
              },
            },
          ],
        };
      },
      replaceDeadline: async () => 'scheduled' as const,
      now: () => currentTime,
    });
  const input = { target, managedTabId: null, automationActive: true, transportSuspended: false } as const;
  const controller = createController();
  const initialSuspension = await controller.reconcileTransport(input);
  const repeatedSuspensionAfterReconstruction = await createController().reconcileTransport(input);
  manualPlaybackActive = false;

  // When: the user navigates away from the playing stream.
  currentTime = 5_000;
  const resumed = await controller.reconcileTransport({ ...input, transportSuspended: true });

  // Then: the prior channel does not keep farming paused.
  expect(initialSuspension).toEqual({
    kind: 'suspend',
    transitionId: 'manual-suspended:campaign-1:1000',
  });
  expect(repeatedSuspensionAfterReconstruction).toEqual(initialSuspension);
  expect(resumed).toEqual({
    kind: 'resume',
    transitionId: 'manual-resumed:campaign-1:5000',
  });

  // When: the user starts a later, separate viewing session for the same campaign.
  manualPlaybackActive = true;
  currentTime = 36_000;
  const laterSuspension = await createController().reconcileTransport(input);

  // Then: it receives a fresh occurrence identifier and can notify again.
  expect(laterSuspension).toEqual({
    kind: 'suspend',
    transitionId: 'manual-suspended:campaign-1:36000',
  });
});
