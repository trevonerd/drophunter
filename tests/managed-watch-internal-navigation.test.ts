import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test.each(['success', 'unavailable', 'cancelled'] as const)(
  'reused Twitch tab navigates internally: %s',
  async (mode) => {
    const mocks = setupChromeMocks();
    const updates: chrome.tabs.UpdateProperties[] = [];
    const scripts: string[] = [];
    let current = mode !== 'cancelled';
    mocks.chrome.tabs.setTabsGetResult({ id: 42, url: 'https://www.twitch.tv/first', status: 'complete' });
    mocks.chrome.tabs.create = async () => {
      throw new Error('Must never create another tab');
    };
    mocks.chrome.tabs.update = async (id, properties = {}) => {
      updates.push(properties);
      return { id, ...properties };
    };
    mocks.chrome.scripting.executeScript = async (options) => {
      expect(options.target.tabId).toBe(42);
      expect(options.args).toEqual(['https://www.twitch.tv/second', 'https://www.twitch.tv/first']);
      scripts.push(options.func.name);
      if (mode === 'unavailable') throw new Error('Receiver unavailable');
      return [{ frameId: 0, result: true }];
    };
    try {
      const navigate = createChromeFarmingAutomationHost().tabs.update(
        42,
        { url: 'https://www.twitch.tv/second', active: false, muted: true },
        () => current,
      );
      if (mode === 'unavailable') await expect(navigate).rejects.toThrow();
      else await navigate;
      expect(updates.some((properties) => properties.url !== undefined)).toBe(false);
      expect(scripts).toEqual(mode === 'cancelled' ? [] : ['navigateTwitchChannelInPage']);
      expect(updates).toEqual(mode === 'success' ? [{ active: false, muted: true }] : []);
      current = false;
    } finally {
      mocks.teardown();
    }
  },
);

test('internal user navigation cannot strand the retained farming tab or authorize another', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add('https://www.twitch.tv/first');
  await managedWatchMarker.write(page.id, 'retained-token', page.url);
  page.url = 'https://www.twitch.tv/manual_channel';
  try {
    const host = createChromeFarmingAutomationHost();
    const reused = await host.tabs.create(
      { url: 'https://www.twitch.tv/second', active: false, muted: true },
      () => true,
      true,
    );
    expect(reused?.id).toBe(page.id);
    expect(page.url).toBe('https://www.twitch.tv/second');
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});
