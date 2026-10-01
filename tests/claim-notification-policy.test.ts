import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  createClaimLogEntry,
  recordClaimedDrops,
  setClaimRecordedHandler,
} from '../src/background/claim-log.ts';
import { createClaimRecordedHandler } from '../src/background/claim-notifications.ts';
import { createNotificationController } from '../src/background/notifications.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import {
  createWatchTransportDrop,
  createWatchTransportState,
  watchTransportGame,
} from './support/farming-session-watch-transport.ts';

let mocks: ChromeMocks;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => {
  setClaimRecordedHandler(null);
  mocks.teardown();
});

test('campaign-aware claim identities preserve two campaigns sharing a reward id', async () => {
  const state = createWatchTransportState();
  const games = ['a', 'b'].map((id) => ({
    ...watchTransportGame,
    campaignId: id,
    campaignName: `Campaign ${id}`,
  }));
  state.appState.availableGames = games;
  const messages: string[] = [];
  setClaimRecordedHandler(
    createClaimRecordedHandler({
      notifyBrowser: async (_title, message) => {
        messages.push(message);
      },
      notifyTelegram: async () => undefined,
    }),
  );
  await recordClaimedDrops(
    state,
    games.map((game) => ({ ...createWatchTransportDrop(game), claimed: true })),
  );
  expect(state.appState.totalDropsClaimed).toBe(2);
  expect(messages).toEqual(['Claimed: Reward (Game · Campaign a)', 'Claimed: Reward (Game · Campaign b)']);
});

for (const scenario of ['disabled', 'permission-denied'] as const) {
  test(`claim alerts honor browser ${scenario} without blocking Telegram`, async () => {
    const state = createWatchTransportState();
    state.appState.notificationsEnabled = scenario !== 'disabled';
    let desktopCalls = 0;
    let telegramCalls = 0;
    let saves = 0;
    const controller = createNotificationController(state, {
      permissionsApi: { contains: async () => false },
      notificationsApi: {
        create: async () => {
          desktopCalls++;
          return 'id';
        },
      },
      saveState: async () => {
        saves++;
      },
    });
    setClaimRecordedHandler(
      createClaimRecordedHandler({
        notifyBrowser: controller.notify,
        notifyTelegram: async () => {
          telegramCalls++;
        },
      }),
    );
    await recordClaimedDrops(state, [{ ...createWatchTransportDrop(watchTransportGame), claimed: true }]);
    expect(desktopCalls).toBe(0);
    expect(telegramCalls).toBe(1);
    expect(state.appState.notificationsEnabled).toBe(false);
    expect(saves).toBe(scenario === 'disabled' ? 0 : 1);
  });
}

for (const failedChannel of ['browser', 'telegram'] as const) {
  test(`a synchronous ${failedChannel} failure preserves independent claim delivery`, async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const calls: string[] = [];
      const handler = createClaimRecordedHandler({
        notifyBrowser: () => {
          calls.push('browser');
          if (failedChannel === 'browser') throw new Error('delivery failed');
          return Promise.resolve();
        },
        notifyTelegram: () => {
          calls.push('telegram');
          if (failedChannel === 'telegram') throw new Error('delivery failed');
          return Promise.resolve();
        },
      });
      await handler([
        createClaimLogEntry({ ...createWatchTransportDrop(watchTransportGame), claimed: true }, []),
      ]);
      expect(calls).toEqual(['browser', 'telegram']);
      expect(warning.mock.calls).toEqual([['[DropHunter]', 'Claim notification delivery failed']]);
    } finally {
      warning.mockRestore();
    }
  });
}

test('an empty claim batch has no delivery effects', async () => {
  const calls: string[] = [];
  await createClaimRecordedHandler({
    notifyBrowser: async () => {
      calls.push('browser');
    },
    notifyTelegram: async () => {
      calls.push('telegram');
    },
  })([]);
  expect(calls).toEqual([]);
});
