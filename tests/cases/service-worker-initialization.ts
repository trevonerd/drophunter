import { expect, test } from 'bun:test';
import { createInitialState } from '../../src/shared/utils.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { chromeMocks, dispatchMessageFromMocks, sleepTick } from '../helpers/service-worker-harness.ts';
import { importServiceWorkerWithBlockedInitialLoad } from '../helpers/service-worker-initialization.ts';

export function registerInitializationCases() {
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
        return null;
      };

      const responsePromise = dispatchMessageFromMocks(isolated.mocks, { type: 'OPEN_DROPS_AND_SYNC' });

      await sleepTick();
      await sleepTick();

      expect(createCalls).toBe(0);
      expect(isolated.setCalls).toHaveLength(0);

      isolated.releaseInitialLoad();
      const response = (await responsePromise) as { success?: boolean; error?: string };

      expect(createCalls).toBe(1);
      expect(response).toMatchObject({
        success: false,
        result: { kind: 'retry-scheduled' },
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
      expect(isolated.setCalls).toHaveLength(0);

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
