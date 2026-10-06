import { expect, test } from 'bun:test';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { listManagedWatches, rememberManagedWatch } from '../src/background/managed-watch-registry.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { managedTabOwnershipKey } from '../src/background/tab-management.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test.each(['same-channel', 'another-channel'] as const)(
  'worker interruption before candidate commit restores the persisted incumbent: %s',
  async (channel) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    try {
      const incumbent = tabs.add('https://www.twitch.tv/incumbent');
      const candidate = tabs.add(
        channel === 'same-channel' ? incumbent.url : 'https://www.twitch.tv/candidate',
      );
      const userTab = tabs.add(candidate.url);
      await managedWatchMarker.write(incumbent.id, 'incumbent-owner', incumbent.url);
      await managedWatchMarker.write(candidate.id, 'candidate-owner', candidate.url);
      await rememberManagedWatch(candidate.id, 'candidate-owner', candidate.url, { provisional: true });
      mocks.storage.session._store.clear();
      const state = createServiceWorkerState();
      const game = createGame({ campaignId: 'incumbent-campaign' });
      const next = createGame({ campaignId: 'candidate-campaign' });
      state.appState.isRunning = true;
      state.appState.watchTransportPreference = 'managed-tab';
      state.appState.manualQueueAuthorized = true;
      state.appState.selectedGame = game;
      state.appState.queue = [game, next];
      state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
      state.appState.tabId = incumbent.id;
      state.appState.watchHealth = createWatchHealth('managed-tab', 'healthy', 'started', Date.now);
      const ownership = await reconcileManagedWatchesOnStartup(state, null);
      if (!ownership) throw new Error('Expected the proven incumbent');
      const coordinator = createWatchTransportCoordinator({
        state,
        heartbeat: async () => ({ accepted: true }),
        managedTab: {
          open: async () => null,
          probe: async () => ({ accepted: true }),
          close: async () => {},
        },
        persist: async () => {},
        broadcast: () => {},
      });
      expect(await coordinator.restore(ownership)).toBe(true);
      expect(coordinator.currentOwnership()).toMatchObject({
        ownershipToken: 'incumbent-owner',
        tabId: incumbent.id,
      });
      expect(coordinator.currentTarget()?.campaignId).toBe(game.campaignId);
      expect(state.appState.queue).toEqual([game, next]);
      expect(tabs.removed).toEqual([candidate.id]);
      expect(tabs.pages.has(userTab.id)).toBe(true);
      expect((await listManagedWatches()).map((watch) => watch.ownershipToken)).toEqual(['incumbent-owner']);
    } finally {
      mocks.teardown();
    }
  },
);

test('startup never discards an extra normal owned watch or an unmarked user tab', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const incumbent = tabs.add('https://www.twitch.tv/incumbent');
    const extra = tabs.add('https://www.twitch.tv/other');
    await managedWatchMarker.write(incumbent.id, 'incumbent-owner', incumbent.url);
    await managedWatchMarker.write(extra.id, 'other-owner', extra.url);
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
    state.appState.tabId = incumbent.id;
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      ownershipToken: 'incumbent-owner',
    });
    expect(tabs.removed).toEqual([]);
    expect(tabs.pages.has(extra.id)).toBe(true);
  } finally {
    mocks.teardown();
  }
});

test('a provisional registry and session proof cannot discard a tab without its exact page marker', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const incumbent = tabs.add('https://www.twitch.tv/incumbent');
    const candidate = tabs.add('https://www.twitch.tv/candidate');
    await managedWatchMarker.write(incumbent.id, 'incumbent-owner', incumbent.url);
    await rememberManagedWatch(candidate.id, 'candidate-owner', candidate.url, { provisional: true });
    mocks.storage.session._store.set(managedTabOwnershipKey('candidate-owner'), {
      version: 1,
      expectedUrl: candidate.url,
    });
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
    state.appState.tabId = incumbent.id;
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      ownershipToken: 'incumbent-owner',
    });
    expect(tabs.removed).toEqual([]);
    expect(tabs.pages.has(candidate.id)).toBe(true);
  } finally {
    mocks.teardown();
  }
});

test('paused startup recovers its retained watch and discards only the interrupted candidate without resuming', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const incumbent = tabs.add('https://www.twitch.tv/incumbent');
    const candidate = tabs.add(incumbent.url);
    await managedWatchMarker.write(incumbent.id, 'incumbent-owner', incumbent.url);
    await managedWatchMarker.write(candidate.id, 'candidate-owner', candidate.url);
    await rememberManagedWatch(candidate.id, 'candidate-owner', candidate.url, { provisional: true });
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.isPaused = true;
    state.appState.selectedGame = createGame();
    state.appState.activeStreamer = createStreamer({ name: 'incumbent' });
    state.appState.tabId = incumbent.id;
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      ownershipToken: 'incumbent-owner',
    });
    expect(state.appState.isPaused).toBe(true);
    expect(state.appState.tabId).toBe(incumbent.id);
    expect(tabs.removed).toEqual([candidate.id]);
  } finally {
    mocks.teardown();
  }
});

test('interruption after candidate persistence restores the candidate and retires only its proven predecessor', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const incumbent = tabs.add('https://www.twitch.tv/incumbent');
    const candidate = tabs.add('https://www.twitch.tv/candidate');
    const unrelated = tabs.add('https://www.twitch.tv/unrelated');
    await managedWatchMarker.write(incumbent.id, 'incumbent-owner', incumbent.url);
    await managedWatchMarker.write(candidate.id, 'candidate-owner', candidate.url);
    await managedWatchMarker.write(unrelated.id, 'unrelated-owner', unrelated.url);
    await rememberManagedWatch(candidate.id, 'candidate-owner', candidate.url, {
      provisional: true,
      replacesOwnershipToken: 'incumbent-owner',
    });
    mocks.storage.session._store.clear();
    const state = createServiceWorkerState();
    const game = createGame({ campaignId: 'candidate-campaign' });
    state.appState.isRunning = true;
    state.appState.watchTransportPreference = 'managed-tab';
    state.appState.selectedGame = game;
    state.appState.activeStreamer = createStreamer({ name: 'candidate' });
    state.appState.tabId = candidate.id;
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      ownershipToken: 'candidate-owner',
    });
    expect(state.appState.selectedGame).toEqual(game);
    expect(state.appState.tabId).toBe(candidate.id);
    expect(tabs.removed).toEqual([incumbent.id]);
    expect(tabs.pages.has(unrelated.id)).toBe(true);
    expect(mocks.storage.local._store.get('managedWatchOwnershipV1:candidate-owner')).not.toHaveProperty(
      'provisional',
    );
    expect((await listManagedWatches()).map((watch) => watch.ownershipToken)).toEqual([
      'candidate-owner',
      'unrelated-owner',
    ]);
  } finally {
    mocks.teardown();
  }
});
