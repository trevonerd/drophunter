import { expect, test } from 'bun:test';
import { FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY } from '../../src/background/farming-automation-contracts.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { chromeMocks, dispatchMessageFromMocks, sleepTick } from '../helpers/service-worker-harness.ts';
import { importServiceWorkerWithBlockedInitialLoad } from '../helpers/service-worker-initialization.ts';
import { createDeferred } from '../support/farming-automation-fixtures.ts';

export function registerInitializationCases() {
  test.each(['PAUSE_FARMING', 'STOP_FARMING'] as const)(
    '%s waits for hydration but interrupts pending automation initialization',
    async (type) => {
      const isolated = await importServiceWorkerWithBlockedInitialLoad(type, {
        ...createInitialState(),
        isRunning: true,
        manualQueueAuthorized: true,
        selectedGame: demoGame,
        queue: [demoGame],
      });
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const get = isolated.mocks.chrome.storage.local.get.bind(isolated.mocks.chrome.storage.local);
      isolated.mocks.chrome.storage.local.get = async (keys) => {
        if (Array.isArray(keys) && keys.includes(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)) {
          entered.resolve();
          await release.promise;
        }
        return get(keys);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        let finished = false;
        const response = dispatchMessageFromMocks(isolated.mocks, { type }).then((value) => {
          finished = true;
          return value;
        });
        await sleepTick();
        expect(finished).toBe(false);
        isolated.releaseInitialLoad();
        await entered.promise;
        const result = await Promise.race([
          response,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Control blocked by automation initialization')),
              1_000,
            );
          }),
        ]);
        expect(result).toMatchObject({ success: true });
        expect(isolated.mocks.storage.local._store.get('appState')).toMatchObject(
          type === 'STOP_FARMING' ? { isRunning: false, lastStopReason: 'user-stop' } : { isPaused: true },
        );
        release.resolve();
        await dispatchMessageFromMocks(isolated.mocks, {
          type: 'SET_MONITOR_AUTO_OPEN',
          payload: { enabled: false },
        });
        expect(isolated.mocks.storage.local._store.get('appState')).toMatchObject(
          type === 'STOP_FARMING' ? { isRunning: false, lastStopReason: 'user-stop' } : { isPaused: true },
        );
        expect(isolated.mocks.chrome.alarms._created.some((alarm) => alarm.name === 'dropCheck')).toBe(false);
      } finally {
        clearTimeout(timer);
        release.resolve();
        await sleepTick();
        isolated.mocks.teardown();
      }
    },
  );

  test('registers runtime onMessage listener at module load', () => {
    expect(chromeMocks.runtime.onMessage._handlers.length).toBeGreaterThan(0);
  });

  test('OPEN_DROPS_AND_SYNC waits for initialization before touching refresh state', async () => {
    const isolated = await importServiceWorkerWithBlockedInitialLoad('open-drops', createInitialState());
    try {
      const chrome = isolated.mocks.chrome;
      let createCalls = 0;
      chrome.tabs.create = async () => {
        createCalls += 1;
        throw new Error('simulated tab creation failure');
      };

      const responsePromise = dispatchMessageFromMocks(isolated.mocks, { type: 'OPEN_DROPS_AND_SYNC' });

      await sleepTick();
      await sleepTick();

      expect(createCalls).toBe(0);
      expect(isolated.setCalls.some((items) => 'appState' in items)).toBe(false);

      isolated.releaseInitialLoad();
      const response = (await responsePromise) as { success?: boolean; error?: string };

      expect(createCalls).toBe(1);
      expect(response).toMatchObject({
        success: false,
        result: { kind: 'retry-failed' },
        error: 'Unable to open the Twitch Drops page.',
      });
    } finally {
      isolated.mocks.teardown();
    }
  });

  test('ACTIVATE_POPUP waits for initialization before checking cache state', async () => {
    const persisted = {
      ...createInitialState(),
      availableGames: [demoGame],
    };
    const isolated = await importServiceWorkerWithBlockedInitialLoad('ensure-cache', persisted);
    const previousFetch = globalThis.fetch;
    try {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('unexpected fetch before initialization');
      }) as typeof fetch;

      const responsePromise = dispatchMessageFromMocks(isolated.mocks, { type: 'ACTIVATE_POPUP' });

      await sleepTick();
      await sleepTick();

      expect(fetchCalls).toBe(0);
      expect(isolated.setCalls.some((items) => 'appState' in items)).toBe(false);

      isolated.releaseInitialLoad();
      const response = (await responsePromise) as {
        success?: boolean;
        result?: { kind?: string };
        appState?: { availableGames?: unknown[] };
      };

      expect(response.success).toBe(true);
      expect(response.result?.kind).toBe('needs-session');
      expect(response.appState?.availableGames).toHaveLength(1);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
      isolated.mocks.teardown();
    }
  });
}
