import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-browser.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createAdapter, target } from './support/farming-automation-browser-fixture.ts';

test('production Chrome host prepares a muted candidate using valid create and update API properties', async () => {
  const mocks = setupChromeMocks();
  const operations: string[] = [];
  mocks.chrome.tabs.create = async (properties) => {
    if ('muted' in properties) throw new TypeError("Unexpected property: 'muted'.");
    expect(properties.url).toBe('about:blank');
    operations.push(`create:${properties.active}`);
    return { id: 22, windowId: 4, url: properties.url, active: false };
  };
  mocks.chrome.tabs.update = async (tabId, properties) => {
    expect(properties.url).toBe('https://www.twitch.tv/channel-b');
    operations.push(`update:${tabId}:${properties.muted}`);
    return { id: tabId, windowId: 4, url: 'https://www.twitch.tv/channel-b', active: false };
  };
  try {
    const adapter = createAdapter(createChromeFarmingAutomationHost(), operations);
    const result = await adapter.watch.prepare(target, 'managed-tab');
    expect(result.kind).toBe('prepared');
    expect(operations).toEqual([
      'create:false',
      'update:22:true',
      'wait:15000',
      'prep:false:false:true',
      'probe:campaign-b',
    ]);
  } finally {
    mocks.teardown();
  }
});

test.each([
  { tabCount: 2, changedUrl: false, expectedRemoved: [22] },
  { tabCount: 1, changedUrl: false, expectedRemoved: [] },
  { tabCount: 2, changedUrl: true, expectedRemoved: [] },
])('failed candidate navigation cleans only an untouched non-sole blank tab: %j', async ({
  tabCount,
  changedUrl,
  expectedRemoved,
}) => {
  const mocks = setupChromeMocks();
  const removed: number[] = [];
  mocks.chrome.tabs.create = async (properties) => ({
    id: 22,
    windowId: 4,
    url: properties.url,
    active: false,
  });
  mocks.chrome.tabs.update = async () => {
    throw new Error('Navigation unavailable');
  };
  mocks.chrome.tabs.get = async () => ({
    id: 22,
    windowId: 4,
    url: changedUrl ? 'https://www.twitch.tv/user-choice' : 'about:blank',
    active: false,
  });
  mocks.chrome.tabs.query = async () =>
    Array.from({ length: tabCount }, (_, index) => ({ id: 22 + index, windowId: 4 }));
  mocks.chrome.tabs.remove = async (id) => {
    removed.push(id);
  };
  try {
    const adapter = createAdapter(createChromeFarmingAutomationHost(), []);
    expect(await adapter.watch.prepare(target, 'managed-tab')).toEqual({
      kind: 'failed',
      reason: 'candidate-unavailable',
    });
    expect(removed).toEqual(expectedRemoved);
  } finally {
    mocks.teardown();
  }
});
