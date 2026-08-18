import { expect } from 'bun:test';
import {
  clearPendingTimingStateSaveForTests,
  setTimingSaveDebounceMsForTests,
} from '../../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../../src/shared/app-state-sync.ts';
import type { AppState, Message } from '../../src/types/index.ts';
import { createSeedDrop, farmingGame, type SnapshotDropSpec } from '../fixtures/auto-claim-scenarios.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import { AutoClaimFetch } from './auto-claim-fetch.ts';

export type AutoClaimHarness = {
  readonly claimRequests: readonly string[];
  readonly beforeEach: () => Promise<void>;
  readonly afterEach: () => void;
  readonly teardown: () => void;
  readonly appState: () => AppState;
  readonly dispatch: (message: Message) => Promise<unknown>;
  readonly refreshTo: (drops: readonly SnapshotDropSpec[]) => Promise<void>;
  readonly startFarm: () => Promise<void>;
  readonly triggerAlarm: (
    drops: readonly SnapshotDropSpec[],
    postClaimDrops?: readonly SnapshotDropSpec[],
  ) => Promise<void>;
  readonly waitForState: (check: (state: AppState) => boolean, message: string) => Promise<AppState>;
  readonly waitTicks: (count?: number) => Promise<void>;
};

function installActiveTabMocks(mocks: ChromeMocks): void {
  mocks.chrome.tabs.create = async ({ url }) => ({
    id: 999,
    windowId: 1,
    url: url ?? 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  mocks.chrome.tabs.update = async (tabId, updateProperties = {}) => ({
    id: tabId,
    windowId: 1,
    url: updateProperties.url ?? 'https://www.twitch.tv/test-streamer',
    active: Boolean(updateProperties.active),
    status: 'complete',
  });
  mocks.chrome.tabs.get = async (tabId) => ({
    id: tabId,
    windowId: 1,
    url: 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  mocks.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === 'PREPARE_STREAM_PLAYBACK') {
      return { success: true, isPlaybackReady: true, userInteractionRequired: false };
    }
    return { success: false };
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function createAutoClaimHarness(): Promise<AutoClaimHarness> {
  const originalFetch = globalThis.fetch;
  const mocks = setupChromeMocks();
  const fetchHarness = new AutoClaimFetch();
  setTimingSaveDebounceMsForTests(0);
  installActiveTabMocks(mocks);
  mocks.tabs.setTabsQueryResult([]);

  const serviceWorkerModule = await import('../../src/background/service-worker.ts?auto-claim-cross-game');
  serviceWorkerModule.startServiceWorker();

  async function waitTicks(count = 1): Promise<void> {
    for (let attempt = 0; attempt < count; attempt += 1) await nextTick();
  }

  function appState(): AppState {
    return normalizeStoredAppState(mocks.storage.local._store.get('appState'));
  }

  async function waitForState(check: (state: AppState) => boolean, message: string): Promise<AppState> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = appState();
      if (check(state)) return state;
      await nextTick();
    }
    throw new Error(message);
  }

  async function waitForCondition(check: () => boolean, message: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (check()) return;
      await nextTick();
    }
    throw new Error(message);
  }

  async function dispatch(message: Message): Promise<unknown> {
    const handler = mocks.runtime.onMessage._handlers[0];
    if (!handler) throw new Error('service worker onMessage handler not registered');
    return new Promise((resolve) => handler(message, {}, (response?: unknown) => resolve(response)));
  }

  async function resetWorkerState(): Promise<void> {
    await dispatch({ type: 'STOP_FARMING' });
    await dispatch({ type: 'CLEAR_QUEUE' });
    await dispatch({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
  }

  async function syncSession(): Promise<void> {
    await new Promise<void>((resolve) => {
      const handler = mocks.runtime.onMessage._handlers[0];
      if (!handler) throw new Error('service worker onMessage handler not registered');
      handler(
        {
          type: 'SYNC_TWITCH_SESSION',
          payload: {
            session: {
              oauthToken: 'oauth-token-with-valid-length-1234567890',
              userId: '123456',
              deviceId: 'device-12345678',
              uuid: 'uuid-1',
            },
          },
        },
        { tab: { id: 999, url: 'https://www.twitch.tv/drops/campaigns' } },
        () => resolve(),
      );
    });
  }

  async function startFarm(): Promise<void> {
    const seedDrop = createSeedDrop();
    fetchHarness.enqueueSnapshot([seedDrop]);
    fetchHarness.enqueueDirectory('streamer-seed');
    fetchHarness.enqueueSnapshot([seedDrop]);
    await syncSession();
    expect(await dispatch({ type: 'START_FARMING', payload: { game: farmingGame } })).toEqual({
      success: true,
    });
    await waitForState(
      (state) => state.isRunning && state.selectedGame?.campaignId === farmingGame.campaignId,
      'start farming did not stabilize on the seed game',
    );
    await waitTicks(5);
    fetchHarness.clearSnapshots();
  }

  async function refreshTo(drops: readonly SnapshotDropSpec[]): Promise<void> {
    fetchHarness.enqueueSnapshot(drops);
    expect(await dispatch({ type: 'REFRESH_DROPS' })).toEqual({ success: true });
    await waitForCondition(() => fetchHarness.isSettled(), 'refresh did not settle on staged snapshot');
  }

  async function triggerAlarm(
    drops: readonly SnapshotDropSpec[],
    postClaimDrops?: readonly SnapshotDropSpec[],
  ): Promise<void> {
    fetchHarness.enqueueSnapshot(drops);
    if (postClaimDrops) fetchHarness.enqueueSnapshot(postClaimDrops);
    mocks.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: Date.now() });
    await nextTick();
  }

  return {
    claimRequests: fetchHarness.claimRequests,
    async beforeEach() {
      fetchHarness.reset();
      installActiveTabMocks(mocks);
      mocks.storage.local._store.clear();
      mocks.storage.session._store.clear();
      mocks.chrome.runtime.onInstalled.trigger({ reason: 'update' });
      await waitTicks(5);
      await resetWorkerState();
      await dispatch({ type: 'SET_AUTO_CLAIM_DROPS', payload: { enabled: true } });
    },
    afterEach() {
      mocks.storage.session._store.clear();
    },
    teardown() {
      clearPendingTimingStateSaveForTests();
      setTimingSaveDebounceMsForTests(null);
      globalThis.fetch = originalFetch;
      mocks.teardown();
    },
    appState,
    dispatch,
    refreshTo,
    startFarm,
    triggerAlarm,
    waitForState,
    waitTicks,
  };
}
