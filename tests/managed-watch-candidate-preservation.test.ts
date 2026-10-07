import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

describe('managed candidate preservation through real browser events', () => {
  let mocks: ReturnType<typeof setupChromeMocks>;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  for (const outcome of ['cancelled', 'navigation-error', 'marker-cancelled'] as const) {
    test(`host retains a single owned tab after ${outcome}`, async () => {
      const tabs = installManagedWatchPages(mocks);
      const incumbent = tabs.add('https://www.twitch.tv/smite_streamer');
      expect(await managedWatchMarker.write(incumbent.id, 'incumbent', incumbent.url)).toBe(true);
      const host = createChromeFarmingAutomationHost(() => ({
        kind: 'managed-tab',
        tabId: incumbent.id,
        ownershipToken: 'incumbent',
        expectedChannel: 'smite_streamer',
      }));
      let current = true;
      const execute = mocks.chrome.scripting.executeScript;
      mocks.chrome.scripting.executeScript = async (options) => {
        const result = await execute(options);
        if (options.func.name === 'navigateTwitchChannelInPage') {
          if (outcome === 'cancelled') current = false;
          if (outcome === 'navigation-error') throw new Error('Navigation failed after starting');
        }
        if (outcome === 'marker-cancelled' && options.args?.includes('https://www.twitch.tv/r6_streamer'))
          current = false;
        return result;
      };
      const properties = {
        url: 'https://www.twitch.tv/r6_streamer',
        active: false as const,
        muted: true as const,
      };
      const changed = await host.tabs.create(properties, () => current, true);
      if (outcome === 'navigation-error') expect(changed?.id).toBe(incumbent.id);
      else expect(changed).toBeNull();

      expect(tabs.pages.size).toBe(1);
      expect(tabs.pages.get(incumbent.id)?.url).toBe(incumbent.url);
      expect(await listManagedWatches()).toMatchObject([
        { tabId: incumbent.id, ownershipToken: 'incumbent' },
      ]);

      mocks.chrome.scripting.executeScript = execute;
      current = true;
      const retried = await host.tabs.create(properties, () => current, true);
      expect(retried?.id).toBeNumber();
      expect(retried?.id).toBe(incumbent.id);
      expect(tabs.pages.get(incumbent.id)?.url).toBe('https://www.twitch.tv/r6_streamer');
    });
  }
});
