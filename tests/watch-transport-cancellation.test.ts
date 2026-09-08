import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  createWatchTransportCoordinator,
  type ManagedTabOpenResult,
} from '../src/background/watch-transport-coordinator.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

describe('watch transport cancellation', () => {
  test('releases a managed candidate without publishing it when cancellation occurs during open', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game 1',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game-1',
    };
    state.appState.watchTransportPreference = 'managed-tab';
    const opened = createDeferred<ManagedTabOpenResult>();
    const opening = createDeferred<void>();
    let closes = 0;
    let persists = 0;
    let broadcasts = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async () => {
          opening.resolve(undefined);
          return opened.promise;
        },
        probe: async () => ({ accepted: true }),
        close: async () => {
          closes += 1;
        },
      },
      persist: async () => {
        persists += 1;
      },
      broadcast: () => {
        broadcasts += 1;
      },
    });
    let current = true;

    const start = coordinator.start(
      { id: 'streamer-1', name: 'streamer', displayName: 'Streamer', isLive: true },
      () => current,
    );
    await opening.promise;
    current = false;
    opened.resolve({ owner: 'drophunter', tabId: 42 });

    await expect(start).resolves.toMatchObject({ mode: 'managed-tab', status: 'healthy' });
    expect(closes).toBe(1);
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.watchHealth).toBeNull();
    expect(persists).toBe(0);
    expect(broadcasts).toBe(0);
  });
});
