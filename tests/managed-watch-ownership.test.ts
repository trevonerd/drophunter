import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from '../src/background/farming-automation-contracts.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { createManagedWatchOwnership } from '../src/background/managed-watch-ownership.ts';
import { listManagedWatches, rememberManagedWatch } from '../src/background/managed-watch-registry.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createStreamer } from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

let mocks: ChromeMocks;
let tabs: ReturnType<typeof installManagedWatchPages>;
beforeEach(() => {
  mocks = setupChromeMocks();
  tabs = installManagedWatchPages(mocks);
});
afterEach(() => mocks.teardown());

test('finalized ownership stays recoverable without starting playback', async () => {
  const ownership = createChromeFarmingAutomationHost().managedWatchOwnership;
  const candidate = await ownership.acquire('first', { allowInitialCreation: true });
  expect(candidate).not.toBeNull();
  if (!candidate) throw new Error('Expected candidate');
  expect(await candidate.confirm()).toBe(true);
  await ownership.finalize(candidate.ownership);
  await ownership.finalize(candidate.ownership);
  expect(
    await ownership.reconstruct(
      candidate.ownership,
      () => ({ running: false, activeChannel: null, tabId: null }),
      () => true,
    ),
  ).toEqual(candidate.ownership);
  expect(await ownership.release(candidate.ownership)).toEqual({ kind: 'not-required' });
  expect(await ownership.observeTabIds()).toEqual([candidate.ownership.tabId]);
  expect(await listManagedWatches()).toEqual([candidate.ownership]);
  expect(tabs.removed).toEqual([]);
});

test('obsolete ownership in a reused tab cannot release the current channel', async () => {
  let current: WatchOwnershipV1 | null = null;
  const ownership = createChromeFarmingAutomationHost(() => current).managedWatchOwnership;
  const first = await ownership.acquire('first', { allowInitialCreation: true });
  if (!first) throw new Error('Expected first candidate');
  expect(await first.confirm()).toBe(true);
  current = first.ownership;
  const second = await ownership.acquire('second');
  if (!second) throw new Error('Expected second candidate');
  expect(await second.confirm()).toBe(true);
  current = second.ownership;
  expect(await ownership.release(first.ownership)).toEqual({ kind: 'not-required' });
  expect(tabs.pages.get(second.ownership.tabId)?.url).toBe('https://www.twitch.tv/second');
  expect(await listManagedWatches()).toEqual([second.ownership]);
  expect(tabs.created).toHaveLength(1);
  expect(tabs.removed).toEqual([]);
});

test.each(['page-load', 'marker-write'] as const)(
  'discard during %s waits for pending proof without rolling back the retained tab',
  async (stage) => {
    const page = tabs.add('https://www.twitch.tv/incumbent');
    await managedWatchMarker.write(page.id, 'incumbent', page.url);
    const current: WatchOwnershipV1 = {
      kind: 'managed-tab',
      tabId: page.id,
      ownershipToken: 'incumbent',
      expectedChannel: 'incumbent',
    };
    const entered = createDeferred<void>();
    const resume = createDeferred<void>();
    const host = createChromeFarmingAutomationHost(() => current);
    const ownership = createManagedWatchOwnership({
      host,
      currentOwnership: () => current,
      recordDurableOwnership: true,
      waitForTabComplete: async () => {
        if (stage === 'page-load') {
          entered.resolve();
          await resume.promise;
        }
      },
    });
    const candidate = await ownership.acquire('replacement');
    if (!candidate) throw new Error('Expected replacement');
    const execute = mocks.chrome.scripting.executeScript;
    if (stage === 'marker-write') {
      mocks.chrome.scripting.executeScript = async (options) => {
        const result = await execute(options);
        if (options.args?.[1] === candidate.ownership.ownershipToken) {
          entered.resolve();
          await resume.promise;
        }
        return result;
      };
    }
    const confirmation = candidate.confirm();
    await entered.promise;
    const disposal = candidate.discard();
    const repeated = candidate.discard();
    resume.resolve();
    expect(await confirmation).toBe(false);
    await Promise.all([disposal, repeated]);
    expect(await candidate.confirm()).toBe(false);
    expect(page.url).toBe('https://www.twitch.tv/replacement');
    expect(await listManagedWatches()).toEqual(
      stage === 'marker-write' ? [candidate.ownership] : [{ ...current, expectedChannel: 'replacement' }],
    );
    expect(tabs.navigated.filter((navigation) => navigation.url === page.url)).toHaveLength(1);
    expect(tabs.removed).toEqual([]);
  },
);

test('session proof failure prevents acquisition without changing a user tab', async () => {
  const page = tabs.add('https://www.twitch.tv/user_choice');
  mocks.storage.session.set = async () => {
    throw new Error('Storage unavailable');
  };
  const ownership = createChromeFarmingAutomationHost().managedWatchOwnership;
  expect(await ownership.acquire('replacement', { allowInitialCreation: true })).toBeNull();
  expect(page.url).toBe('https://www.twitch.tv/user_choice');
  expect(tabs.created).toEqual([]);
  expect(tabs.updated).toEqual([]);
  expect(tabs.removed).toEqual([]);
});

test('startup uses the channel selected during proof recovery and retires only its predecessor', async () => {
  const first = tabs.add('https://www.twitch.tv/first');
  const second = tabs.add('https://www.twitch.tv/second');
  await managedWatchMarker.write(first.id, 'first', first.url);
  await managedWatchMarker.write(second.id, 'second', second.url);
  await rememberManagedWatch(second.id, 'second', second.url, {
    provisional: true,
    replacesOwnershipToken: 'first',
  });
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.activeStreamer = createStreamer({ name: 'first' });
  state.appState.tabId = first.id;
  const get = mocks.storage.local.get;
  let selected = false;
  mocks.storage.local.get = async (keys) => {
    if (keys === null && !selected) {
      selected = true;
      state.appState.activeStreamer = createStreamer({ name: 'second' });
      state.appState.tabId = second.id;
    }
    return get(keys);
  };
  expect(
    await reconcileManagedWatchesOnStartup(state, {
      kind: 'managed-tab',
      tabId: first.id,
      ownershipToken: 'first',
      expectedChannel: 'first',
    }),
  ).toEqual({
    kind: 'managed-tab',
    tabId: second.id,
    ownershipToken: 'second',
    expectedChannel: 'second',
  });
  expect(state.appState.tabId).toBe(second.id);
  expect(state.appState.activeStreamer?.name).toBe('second');
  expect(tabs.removed).toEqual([first.id]);
  expect(second.url).toBe('https://www.twitch.tv/second');
  expect(await listManagedWatches()).toEqual([
    {
      kind: 'managed-tab',
      tabId: second.id,
      ownershipToken: 'second',
      expectedChannel: 'second',
    },
  ]);
});
