import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { createInitialFarmingAutomationFacts } from '../src/background/farming-automation-facts.ts';
import { createFarmingAutomationManualWatch } from '../src/background/farming-automation-manual-watch.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { observeManualPlayback } from '../src/background/playback-orchestrator.ts';
import { managedTabOwnershipKey } from '../src/background/tab-management.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createFarmingSessionAdapters, createMinimalState } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import {
  createAdapter,
  createHost,
  incumbent,
  target,
} from './support/farming-automation-browser-fixture.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test('does not suspend hidden farming for a retained managed Twitch tab', async () => {
  const observed: number[] = [];
  const baseHost = createHost([], {
    manualTabs: [{ id: 11, windowId: 4, url: 'https://www.twitch.tv/channel-a', active: false }],
  });
  const host = {
    ...baseHost,
    tabs: {
      ...baseHost.tabs,
      get: async () => ({ id: 11, windowId: 4, url: 'https://www.twitch.tv/channel-a', active: false }),
    },
    resolveManagedTabIds: async () => [11],
  };
  const adapter = createAdapter(host, [], {
    getManualStreamContext: async (tabId) => {
      observed.push(tabId);
      return { channelName: 'channel-a', isLive: true, isPlaybackReady: true };
    },
  });
  const prepared = await adapter.watch.prepare(target, 'tabless');
  if (prepared.kind !== 'prepared') throw new Error('Expected hidden watch');
  prepared.watch.promote();
  if (incumbent.kind !== 'managed-tab') throw new Error('Expected a managed incumbent');
  await host.sessionStorage.set({
    [managedTabOwnershipKey(incumbent.ownershipToken)]: {
      version: 1,
      expectedUrl: 'https://www.twitch.tv/channel-a',
    },
  });
  expect(await adapter.watch.release(incumbent)).toEqual({ kind: 'not-required' });
  const controller = createFarmingAutomationManualWatch({
    persistence: {
      loadFacts: async () => ({
        kind: 'ready',
        source: 'missing',
        value: createInitialFarmingAutomationFacts(),
      }),
      saveFacts: async () => ({ kind: 'written' }),
    },
    observeManualTabs: adapter.observeManualTabs,
    replaceDeadline: async () => 'scheduled',
    now: () => 1_000,
  });
  const directive = await controller.reconcileTransport({
    target: { id: 'game-b', name: 'Game B', imageUrl: '', campaignId: 'campaign-b' },
    managedTabId: null,
    automationActive: true,
    transportSuspended: false,
  });
  expect(directive).toEqual({ kind: 'unchanged' });
  expect(observed).toEqual([]);

  const mocks = setupChromeMocks();
  try {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = { id: 'game-b', name: 'Game B', imageUrl: '', campaignId: 'campaign-b' };
    state.apiBackoffUntil = Date.now() + 60_000;
    const health = createWatchHealth('tabless', 'healthy', 'heartbeat', Date.now);
    let ticks = 0;
    const notifications: string[] = [];
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        manualWatchController: controller,
        automationNotify: async ({ event }) => {
          notifications.push(event);
        },
        watchTransport: {
          start: async () => ({ kind: 'started', health }),
          tick: async () => {
            ticks += 1;
            return health;
          },
          stop: async () => {
            throw new Error('Retained managed video must not suspend hidden farming');
          },
          setPreference: async () => {},
        },
      }),
    );
    await session.checkDropProgress();
    expect(ticks).toBe(1);
    expect(notifications).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test.each([
  'retained',
  'remapped',
  'multiple',
  'pending',
  'session-proof',
  'personal-navigation',
  'missing',
  'unavailable',
  'ambiguous',
  'storage-failure',
] as const)('resolves durable managed ownership before manual telemetry: %s', async (scenario) => {
  const mocks = setupChromeMocks();
  const pages = installManagedWatchPages(mocks);
  try {
    const owned = pages.add('https://www.twitch.tv/owned_channel');
    const personal = pages.add('https://www.twitch.tv/personal_channel');
    expect(await managedWatchMarker.write(owned.id, 'retained-token', owned.url)).toBe(true);
    if (scenario === 'remapped') {
      pages.pages.delete(owned.id);
      owned.id = 70;
      pages.pages.set(owned.id, owned);
    }
    if (scenario === 'multiple') {
      const other = pages.add('https://www.twitch.tv/other_owned');
      await managedWatchMarker.write(other.id, 'other-token', other.url);
    }
    if (scenario === 'personal-navigation') owned.url = 'https://www.twitch.tv/user_choice';
    if (scenario === 'missing') pages.pages.delete(owned.id);
    if (scenario === 'unavailable')
      mocks.chrome.scripting.executeScript = async () => {
        throw new Error('Unavailable');
      };
    if (scenario === 'ambiguous') {
      const duplicate = pages.add(owned.url);
      duplicate.storage = new Map(owned.storage);
    }
    if (scenario === 'storage-failure')
      mocks.chrome.storage.local.get = async () => {
        throw new Error('Storage unavailable');
      };
    // Reconstruct a host without active ownership or session proof, as after a worker/browser restart.
    mocks.storage.session._store.clear();
    if (scenario === 'pending' || scenario === 'session-proof') {
      await mocks.storage.session.set({
        [managedTabOwnershipKey('retained-token')]: { version: 1, expectedUrl: owned.url, opening: true },
      });
      if (scenario === 'pending') {
        owned.pendingUrl = owned.url;
        owned.url = 'about:blank';
        owned.status = 'loading';
      } else {
        mocks.chrome.scripting.executeScript = async () => {
          throw new Error('Page marker unavailable');
        };
      }
    }
    const host = createChromeFarmingAutomationHost();
    const probed: number[] = [];
    const result = await observeManualPlayback(
      host.tabs,
      async (id) => {
        probed.push(id);
        return { isLive: true, isPlaybackReady: true };
      },
      null,
      host.resolveManagedTabIds,
    );
    if (scenario === 'unavailable' || scenario === 'ambiguous' || scenario === 'storage-failure') {
      expect(result).toEqual({ kind: 'failed' });
      expect(probed).toEqual([]);
    } else {
      expect(result.kind).toBe('observed');
      expect(probed).toEqual(scenario === 'personal-navigation' ? [owned.id, personal.id] : [personal.id]);
    }
    expect(pages.removed).toEqual([]);
    expect(pages.updated).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('ownership observation failure preserves suspension without starting a new manual event', async () => {
  const adapter = createAdapter({ ...createHost([]), resolveManagedTabIds: async () => null }, []);
  const controller = createFarmingAutomationManualWatch({
    persistence: {
      loadFacts: async () => ({
        kind: 'ready',
        source: 'missing',
        value: createInitialFarmingAutomationFacts(),
      }),
      saveFacts: async () => {
        throw new Error('Failed observation must not be persisted');
      },
    },
    observeManualTabs: adapter.observeManualTabs,
    replaceDeadline: async () => 'scheduled',
  });
  for (const transportSuspended of [false, true]) {
    expect(
      await controller.reconcileTransport({
        target: { id: 'game', name: 'Game', imageUrl: '' },
        managedTabId: null,
        automationActive: true,
        transportSuspended,
      }),
    ).toEqual({ kind: 'unchanged' });
  }
});
