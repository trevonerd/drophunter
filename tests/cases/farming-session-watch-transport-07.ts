import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createWatchTransportAdapters,
  createWatchTransportDrop,
  createWatchTransportState,
  watchTransportGame as game,
} from '../support/farming-session-watch-transport.ts';
import { registerManualWatchTransportCases } from './farming-session-watch-transport-08.ts';

let chromeMocks: ChromeMocks;

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

describe('farming session watch transport integration', () => {
  test('delivers a campaign completion through the common notifier after persisting it', async () => {
    const state = createWatchTransportState();
    state.appState.selectedGame = game;
    const completedDrop = {
      ...createWatchTransportDrop(game),
      claimed: true,
      claimable: false,
      progress: 100,
      currentMinutes: 10,
      remainingMinutes: 0,
    };
    const calls: string[] = [];
    const events: Array<{ event: string; transitionId: string }> = [];
    const session = createFarmingSession(
      state,
      createWatchTransportAdapters({
        fetchInventorySnapshotFromApi: async () => ({
          games: [game],
          drops: [completedDrop],
          updatedAt: 1_000,
        }),
        saveState: async () => {
          calls.push(`save:${state.appState.completionNotified}`);
        },
        sendAlert: async (kind) => {
          calls.push(`legacy-alert:${kind}`);
        },
        automationNotify: async (notification) => {
          calls.push(`automatic:${state.appState.completionNotified}`);
          events.push(notification);
        },
      }),
    );

    await session.refreshDropsData({ includeInventoryFetch: true });

    expect(calls).toEqual(['legacy-alert:drop-complete', 'save:true', 'automatic:true', 'save:true']);
    expect(events).toEqual([
      {
        event: 'completion',
        transitionId: 'campaign-complete:campaign-1:drop-1::campaign-1',
        campaignId: 'campaign-1',
        title: 'Campaign complete',
        message: 'All rewards for Game are complete.',
        telegramReason: 'campaign-complete',
      },
    ]);
  });

  registerManualWatchTransportCases(() => chromeMocks);
});
