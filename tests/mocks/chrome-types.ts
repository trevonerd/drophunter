export interface AlarmInfo {
  delayInMinutes?: number;
  periodInMinutes?: number;
  when?: number;
}

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface Tab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  status?: string;
}

export interface MessageSender {
  tab?: Tab;
  frameId?: number;
  id?: string;
  url?: string;
}

export interface BadgeTextDetails {
  text?: string | null;
  tabId?: number;
}

export interface BadgeColorDetails {
  color: string | [number, number, number, number];
  tabId?: number;
}

export interface QueryInfo {
  active?: boolean;
  lastFocusedWindow?: boolean;
  windowId?: number;
  url?: string | string[];
}

export interface TabCreateProperties {
  active?: boolean;
  url?: string;
  windowId?: number;
}

export interface TabUpdateProperties {
  active?: boolean;
  muted?: boolean;
  url?: string;
}

export interface TabUpdateInfo {
  status?: string;
  url?: string;
}

export interface MockMessage {
  type?: string;
  [key: string]: unknown;
}

export interface MockWindow {
  id?: number;
  focused?: boolean;
  tabs?: Tab[];
}

export interface WindowUpdateInfo {
  focused?: boolean;
}

export interface WindowCreateInfo {
  focused?: boolean;
  type?: string;
  url?: string;
}

export interface NotificationOptions {
  iconUrl?: string;
  message: string;
  title: string;
  type?: string;
}

export interface PermissionsRequest {
  permissions?: string[];
  origins?: string[];
}

export interface ScriptInjection {
  target: { tabId: number };
  func: () => unknown;
}

export interface ScriptInjectionResult {
  result?: unknown;
}

export interface ListenerMock<T> {
  addListener: (handler: (arg: T) => void) => void;
  removeListener: (handler: (arg: T) => void) => void;
  trigger: (arg: T) => void;
  _handlers: Array<(arg: T) => void>;
}

export type MessageHandler = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

export interface MessageListenerMock {
  addListener: (handler: MessageHandler) => void;
  removeListener: (handler: MessageHandler) => void;
  trigger: (message: unknown, sender?: MessageSender) => void;
  _handlers: MessageHandler[];
}

export interface StorageMock {
  _store: Map<string, unknown>;
  get: (keys: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
}

export type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;

export interface StorageChangedListenerMock {
  addListener: (handler: (changes: StorageChanges, areaName: string) => void) => void;
  removeListener: (handler: (changes: StorageChanges, areaName: string) => void) => void;
  trigger: (changes: StorageChanges, areaName: string) => void;
  _handlers: Array<(changes: StorageChanges, areaName: string) => void>;
}

export interface MockChrome {
  storage: {
    local: StorageMock;
    session: StorageMock;
    sync: StorageMock;
    onChanged: StorageChangedListenerMock;
  };
  runtime: {
    id: string;
    getManifest: () => { version: string };
    getURL: (path: string) => string;
    onMessage: MessageListenerMock;
    onStartup: ListenerMock<void>;
    onInstalled: ListenerMock<{ reason: 'install' | 'update' | 'chrome_update' }>;
    sendMessage: (message: unknown) => Promise<unknown>;
  };
  alarms: {
    create: (name: string, alarmInfo: AlarmInfo) => void;
    clear: (name: string) => Promise<boolean | undefined>;
    onAlarm: ListenerMock<Alarm>;
    _created: Array<{ name: string; info: AlarmInfo }>;
  };
  tabs: {
    query: (queryInfo: QueryInfo) => Promise<Tab[]>;
    get: (tabId: number) => Promise<Tab>;
    create: (createProperties: TabCreateProperties) => Promise<Tab>;
    update: (tabId: number, updateProperties?: TabUpdateProperties) => Promise<Tab>;
    remove: (tabId: number) => Promise<void>;
    sendMessage: (tabId: number, message: MockMessage) => Promise<unknown>;
    onRemoved: ListenerMock<number>;
    onUpdated: ListenerMock<TabUpdateInfo>;
    setTabsQueryResult: (tabs: Tab[]) => void;
    setTabsGetResult: (tab: Tab) => void;
  };
  windows: {
    get: (windowId: number) => Promise<MockWindow | null>;
    getLastFocused: () => Promise<MockWindow | null>;
    update: (windowId: number, updateInfo: WindowUpdateInfo) => Promise<MockWindow | null>;
    create: (createData?: WindowCreateInfo) => Promise<MockWindow>;
    onRemoved: ListenerMock<number>;
  };
  action: {
    setBadgeText: (details: BadgeTextDetails) => void;
    setBadgeBackgroundColor: (details: BadgeColorDetails) => void;
    getBadgeState: () => { text: string; color: string };
  };
  notifications: {
    create: (options: NotificationOptions) => Promise<string>;
    _notifications: NotificationOptions[];
  };
  permissions: {
    contains: (permissions: PermissionsRequest) => Promise<boolean>;
    request: (permissions: PermissionsRequest) => Promise<boolean>;
    getAll: () => Promise<PermissionsRequest>;
    setContainsResult: (result: boolean) => void;
    setRequestResult: (result: boolean) => void;
    _requests: PermissionsRequest[];
  };
  scripting: {
    executeScript: (options: ScriptInjection) => Promise<ScriptInjectionResult[]>;
  };
}

export interface ChromeMocks extends MockChrome {
  chrome: MockChrome;
  teardown: () => void;
}
