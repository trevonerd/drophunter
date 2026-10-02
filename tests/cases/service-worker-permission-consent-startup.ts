import { expect, test } from 'bun:test';
import { createInitialState } from '../../src/shared/utils.ts';
import { dispatchMessageFromMocks } from '../helpers/service-worker-harness.ts';
import { importServiceWorkerWithBlockedInitialLoad } from '../helpers/service-worker-initialization.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerOptionalPermissionStartupCases() {
  for (const [type, key] of [
    ['SET_NOTIFICATIONS_ENABLED', 'notificationsEnabled'],
    ['SET_TELEGRAM_ALERTS_ENABLED', 'telegramAlertsEnabled'],
  ] as const) {
    test(`${type} starts consent before delayed worker initialization`, async () => {
      const isolated = await importServiceWorkerWithBlockedInitialLoad(
        `${type}-delayed-init`,
        createInitialState(),
      );
      try {
        const chrome = isolated.mocks.chrome;
        chrome.permissions.setContainsResult(true);
        chrome.permissions.setRequestResult(true);
        const response = dispatchMessageFromMocks(
          isolated.mocks,
          { type, payload: { enabled: true } },
          {
            id: chrome.runtime.id,
            url: chrome.runtime.getURL('/popup.html'),
          },
        );
        expect(chrome.permissions._requests).toHaveLength(1);
        expect(isolated.setCalls.some((items) => 'appState' in items)).toBe(false);
        isolated.releaseInitialLoad();
        expect((await response).success).toBe(true);
        expect(isolated.mocks.storage.local._store.get('appState')).toMatchObject({ [key]: true });
      } finally {
        isolated.mocks.teardown();
      }
    });
  }

  test('failed startup initialization never activates a setting after consent', async () => {
    const mocks = setupChromeMocks();
    const originalGet = mocks.storage.local.get.bind(mocks.storage.local);
    let reads = 0;
    mocks.storage.local.get = (keys) => {
      if (reads++ === 0) return Promise.reject(new Error('startup failed'));
      return originalGet(keys);
    };
    try {
      const module = await import(
        `../../src/background/service-worker.ts?permission-startup-failure-${Date.now()}`
      );
      module.startServiceWorker();
      mocks.permissions.setRequestResult(true);
      const response = await dispatchMessageFromMocks(
        mocks,
        {
          type: 'SET_NOTIFICATIONS_ENABLED',
          payload: { enabled: true },
        },
        {
          id: mocks.runtime.id,
          url: mocks.runtime.getURL('/popup.html'),
        },
      );
      expect(mocks.permissions._requests).toHaveLength(1);
      expect(response).toMatchObject({ success: false });
      expect(mocks.storage.local._store.get('appState')).toBeUndefined();
    } finally {
      mocks.teardown();
    }
  });
}
