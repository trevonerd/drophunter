import type { ChromeMocks } from '../mocks/chrome.ts';

export interface ManagedWatchPage {
  id: number;
  windowId: number;
  url: string;
  pendingUrl?: string;
  status: 'loading' | 'complete';
  active?: boolean;
  storage: Map<string, string>;
}

export function installManagedWatchPages(mocks: ChromeMocks) {
  const pages = new Map<number, ManagedWatchPage>();
  const removed: number[] = [];
  let nextId = 20;
  const add = (url: string, id = nextId++) => {
    const page: ManagedWatchPage = { id, windowId: 1, url, status: 'complete', storage: new Map() };
    pages.set(id, page);
    return page;
  };
  mocks.chrome.tabs.get = async (id) => {
    const page = pages.get(id);
    if (!page) throw new Error('No tab');
    return { ...page };
  };
  mocks.chrome.tabs.query = async (query) =>
    [...pages.values()].filter(
      (page) =>
        (query.windowId === undefined || page.windowId === query.windowId) &&
        (query.url === undefined || [query.url].flat().includes(page.url)),
    );
  mocks.chrome.tabs.create = async (properties) => add(properties.url ?? 'about:blank');
  mocks.chrome.tabs.update = async (id, properties) => {
    const page = pages.get(id);
    if (!page) throw new Error('No tab');
    if (properties.url) {
      page.url = properties.url;
      delete page.pendingUrl;
    }
    if (properties.active !== undefined) page.active = properties.active;
    return { ...page };
  };
  mocks.chrome.tabs.remove = async (id) => {
    removed.push(id);
    pages.delete(id);
  };
  mocks.chrome.scripting.executeScript = async (options) => {
    const page = pages.get(options.target.tabId);
    if (!page) throw new Error('No tab');
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    try {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: page.url } });
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => page.storage.get(key) ?? null,
          setItem: (key: string, value: string) => page.storage.set(key, value),
        },
      });
      return [{ frameId: 0, result: Reflect.apply(options.func, undefined, options.args ?? []) }];
    } finally {
      if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
      else Reflect.deleteProperty(globalThis, 'location');
      if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  };
  return { pages, add, removed };
}
