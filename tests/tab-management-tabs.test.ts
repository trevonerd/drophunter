import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  closeManagedTabIfSafe,
  createManagedTab,
  ensureManagedTab,
} from '../src/background/tab-management.ts';
import {
  setupTabManagementMock,
  type TabManagementChrome,
  type TabManagementTab,
  type TabManagementTabUpdateDetails,
} from './mocks/tab-management.ts';

describe('createManagedTab', () => {
  let mock: TabManagementChrome;
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupTabManagementMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => teardown());

  test('reuses current tab when active and URL is about:blank', async () => {
    mock.tabs.setQueryResult([{ id: 42, url: 'about:blank', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('reuses current tab when active and URL is chrome://newtab', async () => {
    mock.tabs.setQueryResult([{ id: 42, url: 'chrome://newtab', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('reuses current tab when active and URL is twitch.tv', async () => {
    mock.tabs.setQueryResult([{ id: 42, url: 'https://www.twitch.tv/other', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('creates new tab when active but current tab is non-reusable URL', async () => {
    mock.tabs.setQueryResult([{ id: 42, url: 'https://example.com', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).not.toBe(42);
  });

  test('creates new tab when not active', async () => {
    mock.tabs.setQueryResult([]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', false);
    expect(result?.url).toBe('https://www.twitch.tv/testchannel');
    expect(result?.active).toBe(false);
  });

  test('returns null when no focused window and create fails', async () => {
    mock.windows.getLastFocused = () => Promise.reject(new Error('no window'));
    mock.tabs.create = () => Promise.reject(new Error('create failed'));
    const result = await createManagedTab('https://www.twitch.tv/testchannel', false);
    expect(result).toBeNull();
  });
});

describe('ensureManagedTab', () => {
  let mock: TabManagementChrome;
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupTabManagementMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => teardown());

  test('returns existing tabId if tab exists and is on Twitch', async () => {
    mock.tabs.setGetResult({ id: 5, url: 'https://www.twitch.tv/current', windowId: 1 });
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/new', false);
    expect(result).toBe(5);
  });

  test('updates URL if existing tab is on Twitch but URL differs', async () => {
    mock.tabs.setGetResult({ id: 5, url: 'https://www.twitch.tv/old', windowId: 1 });
    let updatedTab: TabManagementTab | null = null;
    mock.tabs.update = async (tabId: number, details: TabManagementTabUpdateDetails) => {
      const tab: TabManagementTab = { id: tabId, ...details };
      updatedTab = tab;
      return tab;
    };
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/new', false);
    expect(result).toBe(5);
    expect(updatedTab?.url).toBe('https://www.twitch.tv/new');
  });

  test('reactivates tab if active flag is true and tab is not active', async () => {
    mock.tabs.setGetResult({ id: 5, url: 'https://www.twitch.tv/current', active: false, windowId: 1 });
    let updatedTab: TabManagementTab | null = null;
    mock.tabs.update = async (tabId: number, details: TabManagementTabUpdateDetails) => {
      const tab: TabManagementTab = { id: tabId, ...details };
      updatedTab = tab;
      return tab;
    };
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/current', true);
    expect(result).toBe(5);
    expect(updatedTab?.active).toBe(true);
  });

  test('creates new tab if existing tabId is null', async () => {
    mock.tabs.setQueryResult([]);
    const result = await ensureManagedTab(null, 'https://www.twitch.tv/test', false);
    expect(result).not.toBeNull();
  });

  test('creates new tab if existing tab is not on Twitch', async () => {
    mock.tabs.setGetResult({ id: 5, url: 'https://example.com', windowId: 1 });
    mock.tabs.setQueryResult([]);
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/test', false);
    expect(result).not.toBe(5);
  });
});

describe('closeManagedTabIfSafe', () => {
  let mock: TabManagementChrome;
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupTabManagementMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => teardown());

  test('returns false when tabId is null', async () => {
    const result = await closeManagedTabIfSafe(null);
    expect(result).toBe(false);
  });

  test('returns false when tab not found', async () => {
    mock.tabs.setGetResult(null);
    const result = await closeManagedTabIfSafe(99);
    expect(result).toBe(false);
  });

  test('returns false when window has only one tab', async () => {
    mock.tabs.setGetResult({ id: 5, windowId: 1 });
    mock.tabs.query = () => Promise.resolve([{ id: 5 }]);
    const result = await closeManagedTabIfSafe(5);
    expect(result).toBe(false);
  });

  test('closes tab and returns true when window has multiple tabs', async () => {
    mock.tabs.setGetResult({ id: 5, windowId: 1 });
    mock.tabs.query = () => Promise.resolve([{ id: 5 }, { id: 6 }]);
    let removed = false;
    mock.tabs.remove = async (tabId) => {
      if (tabId === 5) removed = true;
    };
    const result = await closeManagedTabIfSafe(5);
    expect(result).toBe(true);
    expect(removed).toBe(true);
  });
});
