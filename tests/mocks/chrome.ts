interface AlarmInfo { delayInMinutes?: number; periodInMinutes?: number; when?: number }
interface Alarm { name: string; scheduledTime: number; periodInMinutes?: number }
interface Tab { id?: number; url?: string; title?: string; active?: boolean; windowId?: number }
interface MessageSender { tab?: Tab; frameId?: number; id?: string; url?: string }
interface BadgeTextDetails { text?: string | null; tabId?: number }
interface BadgeColorDetails { color: string | [number, number, number, number]; tabId?: number }
interface QueryInfo { active?: boolean; windowId?: number; url?: string | string[] }

interface ListenerMock<T> {
  addListener(handler: (arg: T) => void): void;
  removeListener(handler: (arg: T) => void): void;
  trigger(arg: T): void;
  _handlers: Array<(arg: T) => void>;
}

function createListenerMock<T>(): ListenerMock<T> {
  const handlers: Array<(arg: T) => void> = [];
  return {
    _handlers: handlers,
    addListener(handler) { handlers.push(handler); },
    removeListener(handler) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    },
    trigger(arg) { for (const h of handlers) h(arg); },
  };
}

type MessageHandler = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

interface MessageListenerMock {
  addListener(handler: MessageHandler): void;
  removeListener(handler: MessageHandler): void;
  trigger(message: unknown, sender?: Partial<MessageSender>): void;
  _handlers: MessageHandler[];
}

function createMessageListenerMock(): MessageListenerMock {
  const handlers: MessageHandler[] = [];
  return {
    _handlers: handlers,
    addListener(handler) { handlers.push(handler); },
    removeListener(handler) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    },
    trigger(message, sender = {}) {
      for (const h of handlers) h(message, sender as MessageSender, () => {});
    },
  };
}

function createStorageMock() {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (keys === null) return Promise.resolve(Object.fromEntries(store));
      const result: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        if (store.has(keys)) result[keys] = store.get(keys);
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          if (store.has(k)) result[k] = store.get(k);
        }
      } else {
        for (const [k, def] of Object.entries(keys)) {
          result[k] = store.has(k) ? store.get(k) : def;
        }
      }
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>): Promise<void> {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    clear(): Promise<void> {
      store.clear();
      return Promise.resolve();
    },
  };
}

type StorageMock = ReturnType<typeof createStorageMock>;

export interface ChromeMocks {
  storage: { local: StorageMock; session: StorageMock; sync: StorageMock };
  runtime: {
    onMessage: MessageListenerMock;
    sendMessage: (message: unknown) => Promise<unknown>;
  };
  alarms: {
    create: (name: string, alarmInfo: AlarmInfo) => void;
    _created: Array<{ name: string; info: AlarmInfo }>;
    onAlarm: ListenerMock<Alarm>;
  };
  tabs: {
    query: (queryInfo: QueryInfo) => Promise<Tab[]>;
    get: (tabId: number) => Promise<Tab>;
    setTabsQueryResult: (tabs: Tab[]) => void;
    setTabsGetResult: (tab: Tab) => void;
  };
  action: {
    setBadgeText: (details: BadgeTextDetails) => void;
    setBadgeBackgroundColor: (details: BadgeColorDetails) => void;
    getBadgeState: () => { text: string; color: string };
  };
  notifications: {
    create: (options: unknown) => Promise<string>;
    _notifications: unknown[];
  };
  teardown: () => void;
}

export function setupChromeMocks(): ChromeMocks {
  const originalChrome = (globalThis as Record<string, unknown>).chrome;

  const localStore = createStorageMock();
  const sessionStore = createStorageMock();
  const syncStore = createStorageMock();
  const onMessage = createMessageListenerMock();
  const onAlarm = createListenerMock<Alarm>();
  const createdAlarms: Array<{ name: string; info: AlarmInfo }> = [];
  const badgeState = { text: '', color: '' };
  const notifications: unknown[] = [];
  let tabsQueryResult: Tab[] = [];
  let tabsGetResult: Tab | null = null;

  const mockChrome = {
    storage: { local: localStore, session: sessionStore, sync: syncStore },
    runtime: {
      onMessage,
      sendMessage(_msg: unknown): Promise<unknown> {
        return Promise.resolve(undefined);
      },
    },
    alarms: {
      create(name: string, info: AlarmInfo) { createdAlarms.push({ name, info }); },
      onAlarm,
    },
    tabs: {
      query(_queryInfo: QueryInfo): Promise<Tab[]> { return Promise.resolve(tabsQueryResult); },
      get(_tabId: number): Promise<Tab> {
        if (tabsGetResult === null) return Promise.reject(new Error('tab not found'));
        return Promise.resolve(tabsGetResult);
      },
    },
    action: {
      setBadgeText(details: BadgeTextDetails) { badgeState.text = details.text ?? ''; },
      setBadgeBackgroundColor(details: BadgeColorDetails) {
        badgeState.color = String(details.color ?? '');
      },
    },
    notifications: {
      async create(options: unknown) {
        notifications.push(options);
        return 'notification-id';
      },
    },
  };

  (globalThis as Record<string, unknown>).chrome = mockChrome;

  return {
    storage: { local: localStore, session: sessionStore, sync: syncStore },
    runtime: { onMessage, sendMessage: mockChrome.runtime.sendMessage },
    alarms: {
      create: mockChrome.alarms.create.bind(mockChrome.alarms),
      _created: createdAlarms,
      onAlarm,
    },
    tabs: {
      query: mockChrome.tabs.query,
      get: mockChrome.tabs.get,
      setTabsQueryResult(tabs) { tabsQueryResult = tabs; },
      setTabsGetResult(tab) { tabsGetResult = tab; },
    },
    action: {
      setBadgeText: mockChrome.action.setBadgeText.bind(mockChrome.action),
      setBadgeBackgroundColor: mockChrome.action.setBadgeBackgroundColor.bind(mockChrome.action),
      getBadgeState() { return { ...badgeState }; },
    },
    notifications: {
      create: mockChrome.notifications.create.bind(mockChrome.notifications),
      _notifications: notifications,
    },
    teardown() {
      (globalThis as Record<string, unknown>).chrome = originalChrome;
    },
  };
}
