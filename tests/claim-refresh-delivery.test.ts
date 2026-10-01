import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { autoClaimClaimableDrops } from '../src/background/auto-claim.ts';
import { setClaimRecordedHandler } from '../src/background/claim-log.ts';
import { createClaimRecordedHandler } from '../src/background/claim-notifications.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import {
  createWatchTransportAdapters,
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

test('auto-claim followed by inventory refresh delivers one claim alert per channel', async () => {
  const state = createWatchTransportState();
  state.appState.isRunning = true;
  state.appState.autoClaimDrops = true;
  const claimable = {
    ...createWatchTransportDrop(watchTransportGame),
    claimId: 'claim-1',
    claimable: true,
    progress: 100,
  };
  state.cachedDropsSnapshot = [claimable];
  state.appState.allDrops = [claimable];
  const deliveries: string[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const request: unknown = JSON.parse(String(init?.body));
    expect(request).toMatchObject({ operationName: 'DropsPage_ClaimDropRewards' });
    return new Response(JSON.stringify({ data: { claimDropRewards: { status: 'SUCCESS' } } }));
  });
  try {
    setClaimRecordedHandler(
      createClaimRecordedHandler({
        notifyBrowser: async () => {
          deliveries.push('browser');
        },
        notifyTelegram: async () => {
          deliveries.push('telegram');
        },
      }),
    );
    expect(
      await autoClaimClaimableDrops(state, async () => ({
        oauthToken: 'test-token-at-least-20-chars-long',
        userId: '123456',
        deviceId: 'device-id-test-12345678',
        uuid: 'test-uuid',
        clientIntegrity: 'test-integrity',
      })),
    ).toBe(true);
    const session = createFarmingSession(
      state,
      createWatchTransportAdapters({
        fetchInventorySnapshotFromApi: async () => ({
          games: [watchTransportGame],
          drops: [{ ...claimable, claimed: true, claimable: false }],
          updatedAt: Date.now(),
        }),
        sendAlert: async (kind) => {
          deliveries.push(`legacy:${kind}`);
        },
      }),
    );
    await session.refreshDropsData({ includeInventoryFetch: true });
    expect(deliveries).toEqual(['browser', 'telegram']);
    expect(state.appState.totalDropsClaimed).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

for (const suppressNotifications of [false, true]) {
  test(`inventory refresh records a claim once with browser suppression ${suppressNotifications}`, async () => {
    const state = createWatchTransportState();
    const deliveries: string[] = [];
    const acquired = { ...createWatchTransportDrop(watchTransportGame), claimed: true, progress: 100 };
    setClaimRecordedHandler(
      createClaimRecordedHandler({
        notifyBrowser: async () => {
          deliveries.push('browser');
        },
        notifyTelegram: async () => {
          deliveries.push('telegram');
        },
      }),
    );
    const session = createFarmingSession(
      state,
      createWatchTransportAdapters({
        fetchInventorySnapshotFromApi: async () => ({
          games: [watchTransportGame],
          drops: [acquired],
          updatedAt: Date.now(),
        }),
        sendAlert: async (kind) => {
          deliveries.push(`legacy:${kind}`);
        },
      }),
    );
    await session.refreshDropsData({ includeInventoryFetch: true, suppressNotifications });
    await session.refreshDropsData({ includeInventoryFetch: true });
    expect(deliveries).toEqual(suppressNotifications ? ['telegram'] : ['browser', 'telegram']);
    expect(state.appState.totalDropsClaimed).toBe(1);
  });
}

test('a failed claim-log write retains the completion alert fallback', async () => {
  const state = createWatchTransportState();
  state.appState.selectedGame = watchTransportGame;
  state.appState.completionNotified = true;
  const deliveries: string[] = [];
  const acquired = { ...createWatchTransportDrop(watchTransportGame), claimed: true, progress: 100 };
  const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
  const write = spyOn(mocks.chrome.storage.local, 'set').mockRejectedValue(new Error('storage unavailable'));
  try {
    setClaimRecordedHandler(
      createClaimRecordedHandler({
        notifyBrowser: async () => {
          deliveries.push('browser');
        },
        notifyTelegram: async () => {
          deliveries.push('telegram');
        },
      }),
    );
    const session = createFarmingSession(
      state,
      createWatchTransportAdapters({
        fetchInventorySnapshotFromApi: async () => ({
          games: [watchTransportGame],
          drops: [acquired],
          updatedAt: Date.now(),
        }),
        sendAlert: async (kind) => {
          deliveries.push(kind);
        },
      }),
    );
    await session.refreshDropsData({ includeInventoryFetch: true });
    expect(deliveries).toEqual(['drop-complete']);
    expect(state.appState.totalDropsClaimed).toBe(0);
    expect(warning.mock.calls).toEqual([
      ['[DropHunter]', 'Failed to append claim log entries:', 'Error: storage unavailable'],
    ]);
  } finally {
    write.mockRestore();
    warning.mockRestore();
  }
});
