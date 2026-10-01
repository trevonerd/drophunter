import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createClaimLogEntry, setClaimRecordedHandler } from '../src/background/claim-log.ts';
import { createClaimRecordedHandler } from '../src/background/claim-notifications.ts';
import { CLAIM_LOG_KEY } from '../src/background/constants.ts';
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

test('successful claim delivery does not read the ledger again or emit a legacy duplicate', async () => {
  const state = createWatchTransportState();
  state.appState.selectedGame = watchTransportGame;
  state.appState.completionNotified = true;
  const acquired = { ...createWatchTransportDrop(watchTransportGame), claimed: true, progress: 100 };
  const deliveries: string[] = [];
  const get = spyOn(mocks.chrome.storage.local, 'get');
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    setClaimRecordedHandler(
      createClaimRecordedHandler({
        notifyBrowser: async () => {
          deliveries.push('browser');
          get.mockRejectedValue(new Error('subsequent read unavailable'));
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
    await session.refreshDropsData({ includeInventoryFetch: true });
    expect(deliveries).toEqual(['browser', 'telegram']);
    expect(get).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    get.mockRestore();
    warn.mockRestore();
  }
});

test('a failed ledger read cannot overwrite existing claims and retains completion fallback', async () => {
  const state = createWatchTransportState();
  state.appState.selectedGame = watchTransportGame;
  state.appState.completionNotified = true;
  const acquired = { ...createWatchTransportDrop(watchTransportGame), claimed: true, progress: 100 };
  const existing = [createClaimLogEntry({ ...acquired, id: 'older-reward' }, [])];
  mocks.storage.local._store.set(CLAIM_LOG_KEY, existing);
  const get = spyOn(mocks.chrome.storage.local, 'get').mockRejectedValue(new Error('read unavailable'));
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  const deliveries: string[] = [];
  try {
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
    expect(mocks.storage.local._store.get(CLAIM_LOG_KEY)).toEqual(existing);
    expect(state.appState.totalDropsClaimed).toBe(0);
    expect(warn.mock.calls).toEqual([
      ['[DropHunter]', 'Failed to append claim log entries:', 'Error: read unavailable'],
    ]);
  } finally {
    get.mockRestore();
    warn.mockRestore();
  }
});
