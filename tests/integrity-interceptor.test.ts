import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const STORAGE_KEY = '__drophunter_integrity__';

function createSessionStorageMock() {
  const store = new Map<string, string>();
  return {
    _store: store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

function createWindowEventMock() {
  const listeners: Record<string, Array<(e: CustomEvent) => void>> = {};
  return {
    _listeners: listeners,
    dispatchEvent(event: Event): boolean {
      const customEvent = event as CustomEvent;
      const eventListeners = listeners[event.type] ?? [];
      eventListeners.forEach((h) => h(customEvent));
      return true;
    },
    addEventListener(type: string, handler: (e: CustomEvent) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    removeEventListener(type: string, handler: (e: CustomEvent) => void) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((h) => h !== handler);
      }
    },
  };
}

type MockWindow = {
  fetch: typeof fetch;
  sessionStorage: ReturnType<typeof createSessionStorageMock>;
  dispatchEvent: (event: Event) => boolean;
  addEventListener: (type: string, handler: (e: CustomEvent) => void) => void;
  removeEventListener: (type: string, handler: (e: CustomEvent) => void) => void;
};

let mockWindow: MockWindow;
let originalWindow: unknown;
let originalFetch: typeof globalThis.fetch;

function makeIntegrityFetch(body: unknown): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.includes('gql.twitch.tv/integrity')) {
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function applyInterceptorLogic(
  fetchFn: typeof fetch,
  sessionStorage: ReturnType<typeof createSessionStorageMock>,
  dispatchFn: (event: Event) => boolean,
): typeof fetch {
  return (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
    const promise = fetchFn.apply(null, args);

    if (url.includes('gql.twitch.tv/integrity')) {
      promise
        .then((response) => response.clone().json())
        .then((data: unknown) => {
          if (typeof data !== 'object') return;
          const p = data as Record<string, unknown> | null;
          if (p && typeof p.token === 'string' && p.token.length > 0) {
            const integrity = {
              token: p.token,
              expiration: typeof p.expiration === 'number' ? p.expiration : 0,
              request_id: typeof p.request_id === 'string' ? p.request_id : '',
              timestamp: Date.now(),
            };
            try {
              sessionStorage.setItem(STORAGE_KEY, JSON.stringify(integrity));
            } catch (_) {
              void 0;
            }
            dispatchFn(new CustomEvent(STORAGE_KEY, { detail: JSON.stringify(integrity) }));
          }
        })
        .catch(() => undefined);
    }
    return promise;
  };
}

describe('integrity-interceptor — core logic', () => {
  beforeEach(() => {
    originalWindow = (globalThis as Record<string, unknown>).window;
    originalFetch = globalThis.fetch;
    mockWindow = {
      ...createWindowEventMock(),
      fetch: globalThis.fetch ?? (async () => new Response(null, { status: 404 })),
      sessionStorage: createSessionStorageMock(),
    };
    (globalThis as Record<string, unknown>).window = mockWindow;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = originalWindow;
    globalThis.fetch = originalFetch;
    mockWindow.sessionStorage.clear();
  });

  test('stores integrity token in sessionStorage when fetch returns valid payload', async () => {
    const payload = { token: 'abc123', expiration: 9999999, request_id: 'req-1' };
    const wrappedFetch = applyInterceptorLogic(
      makeIntegrityFetch(payload),
      mockWindow.sessionStorage,
      mockWindow.dispatchEvent.bind(mockWindow),
    );

    await wrappedFetch('https://gql.twitch.tv/integrity', { method: 'POST' });
    await flushPromises();

    const stored = mockWindow.sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.token).toBe('abc123');
    expect(parsed.expiration).toBe(9999999);
    expect(parsed.request_id).toBe('req-1');
  });

  test('type guard: non-object response (number 42) does not crash and does not write sessionStorage', async () => {
    const wrappedFetch = applyInterceptorLogic(
      makeIntegrityFetch(42),
      mockWindow.sessionStorage,
      mockWindow.dispatchEvent.bind(mockWindow),
    );

    await wrappedFetch('https://gql.twitch.tv/integrity', { method: 'POST' });
    await flushPromises();

    expect(mockWindow.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('token guard: non-string token field (number) does not write sessionStorage', async () => {
    const wrappedFetch = applyInterceptorLogic(
      makeIntegrityFetch({ token: 123, expiration: 9999 }),
      mockWindow.sessionStorage,
      mockWindow.dispatchEvent.bind(mockWindow),
    );

    await wrappedFetch('https://gql.twitch.tv/integrity', { method: 'POST' });
    await flushPromises();

    expect(mockWindow.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('non-integrity URLs are passed through without storing anything', async () => {
    let passedThrough = false;
    const passThroughFetch: typeof fetch = async () => {
      passedThrough = true;
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
    };
    const wrappedFetch = applyInterceptorLogic(
      passThroughFetch,
      mockWindow.sessionStorage,
      mockWindow.dispatchEvent.bind(mockWindow),
    );

    await wrappedFetch('https://api.twitch.tv/helix/streams', {});
    await flushPromises();

    expect(passedThrough).toBe(true);
    expect(mockWindow.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('dispatchEvent is called with the integrity storage key after successful storage', async () => {
    const dispatchedTypes: string[] = [];
    const dispatchFn = (event: Event): boolean => {
      dispatchedTypes.push(event.type);
      return true;
    };
    const wrappedFetch = applyInterceptorLogic(
      makeIntegrityFetch({ token: 'dispatch-test-token', expiration: 12345 }),
      mockWindow.sessionStorage,
      dispatchFn,
    );

    await wrappedFetch('https://gql.twitch.tv/integrity', { method: 'POST' });
    await flushPromises();

    expect(dispatchedTypes).toContain(STORAGE_KEY);
  });
});
