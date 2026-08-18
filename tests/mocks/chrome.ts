import { resetSaveStateBroadcastCacheForTests } from '../../src/background/state-persistence';
import { createListenerMock, createMessageListenerMock } from './chrome-events.ts';
import { createStorageMock } from './chrome-storage.ts';
import type {
  Alarm,
  AlarmInfo,
  ChromeMocks as ChromeMocksContract,
  MockChrome as MockChromeContract,
  NotificationOptions,
  PermissionsRequest,
  StorageChangedListenerMock,
  StorageChanges,
  Tab,
} from './chrome-types.ts';

export type ChromeMocks = ChromeMocksContract;
export type MockChrome = MockChromeContract;

function createStorageChangedListenerMock(): StorageChangedListenerMock {
  const handlers: StorageChangedListenerMock['_handlers'] = [];
  return {
    _handlers: handlers,
    addListener(handler) {
      handlers.push(handler);
    },
    removeListener(handler) {
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    },
    trigger(changes: StorageChanges, areaName: string) {
      for (const handler of handlers) handler(changes, areaName);
    },
  };
}

export function setupChromeMocks(): ChromeMocks {
  resetSaveStateBroadcastCacheForTests();
  const originalChrome = Reflect.get(globalThis, 'chrome');
  const originalBrowser = Reflect.get(globalThis, 'browser');

  const storage = {
    local: createStorageMock(),
    session: createStorageMock(),
    sync: createStorageMock(),
    onChanged: createStorageChangedListenerMock(),
  };
  const runtime = {
    id: 'test-extension',
    getManifest: () => ({ version: '4.0.0' }),
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    onMessage: createMessageListenerMock(),
    onStartup: createListenerMock<void>(),
    onInstalled: createListenerMock<{ reason: 'install' | 'update' | 'chrome_update' }>(),
    sendMessage: (_message: unknown): Promise<unknown> => Promise.resolve(undefined),
  };

  const createdAlarms: Array<{ name: string; info: AlarmInfo }> = [];
  const alarms = {
    create(name: string, info: AlarmInfo) {
      createdAlarms.push({ name, info });
    },
    clear: (_name: string): Promise<boolean | undefined> => Promise.resolve(true),
    onAlarm: createListenerMock<Alarm>(),
    _created: createdAlarms,
  };

  let tabsQueryResult: Tab[] = [];
  let tabsGetResult: Tab | null = null;
  const tabs: MockChrome['tabs'] = {
    query: (_queryInfo) => Promise.resolve(tabsQueryResult),
    get: (tabId) =>
      tabsGetResult === null
        ? Promise.reject(new Error(`tab ${tabId} not found`))
        : Promise.resolve(tabsGetResult),
    create: (createProperties) =>
      Promise.resolve({ id: 999, windowId: createProperties.windowId ?? 1, ...createProperties }),
    update: (tabId, updateProperties = {}) => Promise.resolve({ id: tabId, ...updateProperties }),
    remove: (_tabId) => Promise.resolve(),
    sendMessage: (_tabId, _message) => Promise.resolve({ success: false }),
    onRemoved: createListenerMock<number>(),
    onUpdated: createListenerMock(),
    setTabsQueryResult(nextTabs) {
      tabsQueryResult = nextTabs;
    },
    setTabsGetResult(nextTab) {
      tabsGetResult = nextTab;
    },
  };

  const windows: MockChrome['windows'] = {
    get: (_windowId) => Promise.resolve(null),
    getLastFocused: () => Promise.resolve({ id: 1 }),
    update: (_windowId, _updateInfo) => Promise.resolve(null),
    create: (_createData) => Promise.resolve({ id: 1 }),
    onRemoved: createListenerMock<number>(),
  };

  const badgeState = { text: '', color: '' };
  const action: MockChrome['action'] = {
    setBadgeText(details) {
      badgeState.text = details.text ?? '';
    },
    setBadgeBackgroundColor(details) {
      badgeState.color = String(details.color);
    },
    getBadgeState: () => ({ ...badgeState }),
  };

  const notificationList: NotificationOptions[] = [];
  const notifications: MockChrome['notifications'] = {
    async create(options) {
      notificationList.push(options);
      return 'notification-id';
    },
    _notifications: notificationList,
  };

  const permissionRequests: PermissionsRequest[] = [];
  let permissionsContainsResult = false;
  let permissionsRequestResult = false;
  const permissions: MockChrome['permissions'] = {
    contains: (_request) => Promise.resolve(permissionsContainsResult),
    request(request) {
      permissionRequests.push(request);
      return Promise.resolve(permissionsRequestResult);
    },
    getAll: () => Promise.resolve({ permissions: [], origins: [] }),
    setContainsResult(result) {
      permissionsContainsResult = result;
    },
    setRequestResult(result) {
      permissionsRequestResult = result;
    },
    _requests: permissionRequests,
  };

  const scripting: MockChrome['scripting'] = {
    executeScript: (_options) => Promise.resolve([]),
  };
  const chrome: MockChrome = {
    storage,
    runtime,
    alarms,
    tabs,
    windows,
    action,
    notifications,
    permissions,
    scripting,
  };

  Reflect.set(globalThis, 'chrome', chrome);
  Reflect.set(globalThis, 'browser', chrome);

  return {
    chrome,
    ...chrome,
    teardown() {
      if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
      else Reflect.set(globalThis, 'chrome', originalChrome);
      if (originalBrowser === undefined) Reflect.deleteProperty(globalThis, 'browser');
      else Reflect.set(globalThis, 'browser', originalBrowser);
    },
  };
}
