import { afterEach, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const mocks = setupChromeMocks();
afterEach(() => mocks.teardown());

test('every campaign change reuses the owned viewing tab, including queued Play', async () => {
  const tabs = installManagedWatchPages(mocks);
  const host = createChromeFarmingAutomationHost();
  const first = await host.managedWatchOwnership.acquire('first', { allowInitialCreation: true });
  expect(await first?.confirm()).toBe(true);
  const second = await host.managedWatchOwnership.acquire('second', { allowInitialCreation: true });
  expect(await second?.confirm()).toBe(true);
  expect(second?.ownership.tabId).toBe(first?.ownership.tabId);
  expect(tabs.pages.size).toBe(1);
  await first?.discard();
  if (!second) throw new Error('Missing replacement ownership');
  expect(tabs.pages.get(second.ownership.tabId)?.url).toBe('https://www.twitch.tv/second');
});
