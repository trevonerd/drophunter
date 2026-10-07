import type { ChromeMocks } from '../mocks/chrome.ts';

export interface ManagedWatchPage {
  id: number;
  windowId: number;
  url: string;
  pendingUrl?: string;
  status: 'loading' | 'complete';
  active?: boolean;
  playing?: boolean;
  storage: Map<string, string>;
}

export function installManagedWatchPages(mocks: ChromeMocks) {
  const pages = new Map<number, ManagedWatchPage>();
  const removed: number[] = [];
  const created: number[] = [];
  const updated: { id: number; properties: chrome.tabs.UpdateProperties }[] = [];
  const navigated: { id: number; url: string }[] = [];
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
        (query.url === undefined ||
          [query.url]
            .flat()
            .some((url) => (url.endsWith('*') ? page.url.startsWith(url.slice(0, -1)) : url === page.url))),
    );
  mocks.chrome.tabs.create = async (properties) => {
    const page = add(properties.url ?? 'about:blank');
    created.push(page.id);
    return page;
  };
  mocks.chrome.tabs.update = async (id, properties = {}) => {
    updated.push({ id, properties });
    const page = pages.get(id);
    if (!page) throw new Error('No tab');
    if (properties.url) {
      if (page.url !== properties.url) page.playing = false;
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
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const routeGlobals = ['history', 'dispatchEvent', 'PopStateEvent'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    try {
      Object.defineProperty(globalThis, 'history', {
        configurable: true,
        value: {
          state: null,
          pushState: (_state: unknown, _unused: string, url: string) => {
            navigated.push({ id: page.id, url });
            page.url = url;
            page.playing = false;
          },
        },
      });
      Object.defineProperty(globalThis, 'dispatchEvent', { configurable: true, value: () => true });
      Object.defineProperty(globalThis, 'PopStateEvent', { configurable: true, value: class {} });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          querySelectorAll: () => [
            {
              pause: () => {
                page.playing = false;
              },
            },
          ],
        },
      });
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: {
          get href() {
            return page.url;
          },
          get origin() {
            return new URL(page.url).origin;
          },
        },
      });
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => page.storage.get(key) ?? null,
          setItem: (key: string, value: string) => page.storage.set(key, value),
        },
      });
      return [{ frameId: 0, result: Reflect.apply(options.func, undefined, options.args ?? []) }];
    } finally {
      for (const [key, descriptor] of routeGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
      else Reflect.deleteProperty(globalThis, 'location');
      if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  };
  return { pages, add, removed, created, updated, navigated };
}
