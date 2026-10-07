import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import {
  managedWatchMarker,
  serializeManagedWatchMutation,
  writeManagedWatchMarkerInPage,
} from '../src/background/managed-watch-marker.ts';
import { releaseManagedTabOwnership } from '../src/background/managed-watch-ownership-proof.ts';
import { browser } from '../src/shared/browser-api.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/old_channel';
const ownership = {
  kind: 'managed-tab' as const,
  tabId: 20,
  ownershipToken: 'old-token',
  expectedChannel: 'old_channel',
};

test.each(['new-url', 'new-token', 'new-window'] as const)(
  'discard preserves a page changed during its window query: %s',
  async (change) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    const page = tabs.add(url);
    tabs.add('https://example.com');
    const host = createChromeFarmingAutomationHost();
    try {
      expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);
      const query = host.tabs.query.bind(host.tabs);
      host.tabs.query = async (properties) => {
        const result = await query(properties);
        if (properties.windowId !== undefined) {
          if (change === 'new-url') page.url = 'https://www.twitch.tv/new_channel';
          if (change === 'new-window') page.windowId = 99;
          if (change === 'new-token')
            expect(await managedWatchMarker.write(page.id, 'new-token', url)).toBe(true);
        }
        return result;
      };

      expect(await releaseManagedTabOwnership(ownership, host, { discard: true })).toEqual({
        kind: 'abandoned-unproven',
      });
      expect(tabs.pages.has(page.id)).toBe(true);
      expect(tabs.created).toEqual([]);
      expect(tabs.removed).toEqual([]);
      expect(tabs.updated).toEqual([]);
      if (change === 'new-token')
        expect((await managedWatchMarker.locate('new-token', url))?.id).toBe(page.id);
    } finally {
      mocks.teardown();
    }
  },
);

test('discard preserves the sole window when its final other tab closes during cleanup', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add(url);
  const peer = tabs.add('https://example.com');
  const host = createChromeFarmingAutomationHost();
  try {
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);
    const query = host.tabs.query.bind(host.tabs);
    host.tabs.query = async (properties) => {
      const result = await query(properties);
      if (properties.windowId !== undefined) tabs.pages.delete(peer.id);
      return result;
    };

    await releaseManagedTabOwnership(ownership, host, { discard: true });

    expect(tabs.pages.has(page.id)).toBe(true);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('discard neutralizes a proved sole tab without closing its window', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add(url);
  const host = createChromeFarmingAutomationHost();
  try {
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);

    expect(await releaseManagedTabOwnership(ownership, host, { discard: true })).toEqual({
      kind: 'released',
      method: 'neutralized',
    });
    expect(tabs.pages.has(page.id)).toBe(true);
    expect(page.url).toBe('about:blank');
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test.each([1, 2])(
  'native cleanup rechecks ownership inside the mutation queue with %s window tabs',
  async (tabCount) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    const page = tabs.add(url);
    if (tabCount === 2) tabs.add('https://example.com');
    const host = createChromeFarmingAutomationHost();
    const entered = createDeferred<void>();
    const unblock = createDeferred<void>();
    const queued = createDeferred<void>();
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);
    const update = host.tabs.update.bind(host.tabs);
    const remove = host.tabs.remove.bind(host.tabs);
    host.tabs.update = async (...args) => {
      queued.resolve();
      await update(...args);
    };
    host.tabs.remove = async (...args) => {
      queued.resolve();
      await remove(...args);
    };
    const mutation = serializeManagedWatchMutation(async () => {
      entered.resolve();
      await unblock.promise;
      await browser.scripting.executeScript({
        target: { tabId: page.id },
        func: writeManagedWatchMarkerInPage,
        args: ['__drophunter_managed_watch_v1', 'new-token', url],
      });
    });
    await entered.promise;
    const cleanup = releaseManagedTabOwnership(ownership, host, { discard: true });
    try {
      await queued.promise;
      unblock.resolve();
      await mutation;

      expect(await cleanup).toEqual({ kind: 'abandoned-unproven' });
      expect(page.url).toBe(url);
      expect((await managedWatchMarker.locate('new-token', url))?.id).toBe(page.id);
      expect(tabs.removed).toEqual([]);
      expect(tabs.updated).toEqual([]);
    } finally {
      unblock.resolve();
      await mutation;
      await cleanup.catch(() => undefined);
      mocks.teardown();
    }
  },
);
