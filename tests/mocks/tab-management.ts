interface TabUpdateInfo {
  readonly status?: string;
}

export interface TabManagementTab {
  readonly id?: number;
  readonly url?: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly windowId?: number;
  readonly status?: string;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  readonly groupId?: number;
}

export interface TabManagementTabUpdateDetails {
  readonly url?: string;
  readonly active?: boolean;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  readonly highlighted?: boolean;
}

interface TabManagementWindow {
  readonly id?: number;
  readonly focused?: boolean;
  readonly alwaysOnTop?: boolean;
  readonly type?: string;
  readonly state?: string;
}

interface WindowUpdateInfo {
  readonly focused?: boolean;
  readonly alwaysOnTop?: boolean;
  readonly state?: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
}

interface TabUpdatedEvents {
  addListener: (handler: (tabId: number, info: TabUpdateInfo) => void) => void;
  removeListener: (handler: (tabId: number, info: TabUpdateInfo) => void) => void;
  trigger: (tabId: number, info: TabUpdateInfo) => void;
}

export interface TabManagementChrome {
  tabs: {
    query: (queryInfo: Record<string, unknown>) => Promise<readonly TabManagementTab[]>;
    get: (tabId: number) => Promise<TabManagementTab>;
    create: (details: {
      readonly windowId?: number;
      readonly url?: string;
      readonly active?: boolean;
    }) => Promise<TabManagementTab>;
    update: (tabId: number, details: TabManagementTabUpdateDetails) => Promise<TabManagementTab>;
    remove: (tabId: number) => Promise<void>;
    onUpdated: TabUpdatedEvents;
    setQueryResult: (tabs: readonly TabManagementTab[]) => void;
    setGetResult: (tab: TabManagementTab | null) => void;
  };
  windows: {
    getLastFocused: () => Promise<TabManagementWindow>;
    update: (windowId: number, details: WindowUpdateInfo) => Promise<TabManagementWindow>;
    create: (details: Record<string, unknown>) => Promise<TabManagementWindow>;
  };
  runtime: {
    getURL: (path: string) => string;
  };
}

interface TabManagementMockSetup {
  readonly mock: TabManagementChrome;
  readonly teardown: () => void;
}

export function setupTabManagementMock(): TabManagementMockSetup {
  let tabsQueryResult: readonly TabManagementTab[] = [];
  let tabsGetResult: TabManagementTab | null | undefined;
  const tabRegistry = new Map<number, TabManagementTab>();
  let nextTabId = 1;
  const lastFocusedWindow: TabManagementWindow = { id: 1, focused: true };
  const onUpdatedHandlers: Array<(tabId: number, info: TabUpdateInfo) => void> = [];

  const mock: TabManagementChrome = {
    tabs: {
      query: (_queryInfo) => Promise.resolve(tabsQueryResult),
      get: (tabId) => {
        if (tabsGetResult !== undefined) {
          return tabsGetResult === null
            ? Promise.reject(new Error('tab not found'))
            : Promise.resolve(tabsGetResult);
        }
        const tab = tabRegistry.get(tabId);
        return tab ? Promise.resolve(tab) : Promise.reject(new Error('tab not found'));
      },
      create: (details) => {
        const id = nextTabId++;
        const tab: TabManagementTab = {
          id,
          url: details.url,
          active: details.active ?? false,
          windowId: details.windowId ?? lastFocusedWindow.id ?? 1,
        };
        tabRegistry.set(id, tab);
        return Promise.resolve(tab);
      },
      update: (tabId, details) => {
        const updated: TabManagementTab = { ...tabRegistry.get(tabId), id: tabId, ...details };
        tabRegistry.set(tabId, updated);
        return Promise.resolve(updated);
      },
      remove: (tabId) => {
        tabRegistry.delete(tabId);
        return Promise.resolve();
      },
      onUpdated: {
        addListener: (handler) => onUpdatedHandlers.push(handler),
        removeListener: (handler) => {
          const index = onUpdatedHandlers.indexOf(handler);
          if (index !== -1) onUpdatedHandlers.splice(index, 1);
        },
        trigger: (tabId, info) => {
          for (const handler of onUpdatedHandlers) handler(tabId, info);
        },
      },
      setQueryResult: (tabs) => {
        tabsQueryResult = tabs;
      },
      setGetResult: (tab) => {
        tabsGetResult = tab;
      },
    },
    windows: {
      getLastFocused: () => Promise.resolve(lastFocusedWindow),
      update: (windowId, details) => {
        if (lastFocusedWindow.id === windowId) Object.assign(lastFocusedWindow, details);
        return Promise.resolve({ ...lastFocusedWindow });
      },
      create: (details) => Promise.resolve({ id: nextTabId++, focused: true, ...details }),
    },
    runtime: {
      getURL: (path) => `chrome-extension://mock-id/${path.replace(/^\//, '')}`,
    },
  };

  const originalChrome = Reflect.get(globalThis, 'chrome');
  const originalBrowser = Reflect.get(globalThis, 'browser');
  Reflect.set(globalThis, 'chrome', mock);
  Reflect.set(globalThis, 'browser', mock);

  return {
    mock,
    teardown: () => {
      if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
      else Reflect.set(globalThis, 'chrome', originalChrome);
      if (originalBrowser === undefined) Reflect.deleteProperty(globalThis, 'browser');
      else Reflect.set(globalThis, 'browser', originalBrowser);
    },
  };
}
