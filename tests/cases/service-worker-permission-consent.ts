import { expect, test } from 'bun:test';
import { exportBackup } from '../../src/shared/backup.ts';
import { chromeMocks, dispatchMessage, getAppStateFromStorage } from '../helpers/service-worker-harness.ts';

export function registerOptionalPermissionConsentCases() {
  const trustedPopup = () => ({
    id: chromeMocks.runtime.id,
    url: chromeMocks.runtime.getURL('/popup.html'),
  });

  const settings = [
    ['SET_NOTIFICATIONS_ENABLED', 'notificationsEnabled'],
    ['SET_TELEGRAM_ALERTS_ENABLED', 'telegramAlertsEnabled'],
  ] as const;

  for (const [type, key] of settings) {
    test(`${type} requests permission synchronously and persists after consent`, async () => {
      const originalRequest = chromeMocks.permissions.request;
      let accept: (value: boolean) => void = () => undefined;
      let requested = false;
      chromeMocks.permissions.request = () => {
        requested = true;
        return new Promise<boolean>((resolve) => {
          accept = resolve;
        });
      };
      try {
        const response = dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        expect(requested).toBe(true);
        const foreign = await dispatchMessage(
          { type, payload: { enabled: true } },
          { id: 'another-extension', url: chromeMocks.runtime.getURL('/popup.html') },
        );
        expect(foreign.success).toBe(false);
        chromeMocks.permissions.setContainsResult(true);
        accept(true);
        expect((await response).success).toBe(true);
        expect(getAppStateFromStorage()[key]).toBe(true);
      } finally {
        chromeMocks.permissions.request = originalRequest;
        await dispatchMessage({ type, payload: { enabled: false } });
      }
    });

    test(`${type} leaves the setting disabled when permission is denied or request throws`, async () => {
      const originalRequest = chromeMocks.permissions.request;
      try {
        chromeMocks.permissions.setContainsResult(false);
        chromeMocks.permissions.request = () => Promise.resolve(false);
        const denied = await dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        expect(denied).toMatchObject({ success: false });
        expect(getAppStateFromStorage()[key]).toBe(false);

        chromeMocks.permissions.request = () => Promise.reject(new Error('permission API failed'));
        const failed = await dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        expect(failed).toMatchObject({ success: false });
        expect(getAppStateFromStorage()[key]).toBe(false);
      } finally {
        chromeMocks.permissions.request = originalRequest;
      }
    });

    test(`${type} accepts an already granted permission`, async () => {
      const originalRequest = chromeMocks.permissions.request;
      chromeMocks.permissions.setContainsResult(true);
      chromeMocks.permissions.setRequestResult(true);
      try {
        const response = await dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        expect(response.success).toBe(true);
        expect(chromeMocks.permissions._requests).toHaveLength(1);
        expect(getAppStateFromStorage()[key]).toBe(true);
      } finally {
        chromeMocks.permissions.request = originalRequest;
        await dispatchMessage({ type, payload: { enabled: false } });
      }
    });

    test(`${type} ignores a late grant after the user disables the setting`, async () => {
      const originalRequest = chromeMocks.permissions.request;
      let accept: (value: boolean) => void = () => undefined;
      let requested = false;
      chromeMocks.permissions.request = () => {
        requested = true;
        return new Promise<boolean>((resolve) => {
          accept = resolve;
        });
      };
      try {
        const enabling = dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        expect(requested).toBe(true);
        const disabled = await dispatchMessage({ type, payload: { enabled: false } }, trustedPopup());
        expect(disabled.success).toBe(true);
        chromeMocks.permissions.setContainsResult(true);
        accept(true);
        expect(await enabling).toMatchObject({
          success: false,
          error: 'Setting changed while permission was pending',
        });
        expect(getAppStateFromStorage()[key]).toBe(false);
      } finally {
        chromeMocks.permissions.request = originalRequest;
      }
    });

    test(`${type} rejects an out-of-order grant when permission inspection is still pending`, async () => {
      const originalContains = chromeMocks.permissions.contains;
      let resolveContains: (value: boolean) => void = () => undefined;
      let notifyContainsStarted: () => void = () => undefined;
      const containsStarted = new Promise<void>((resolve) => {
        notifyContainsStarted = resolve;
      });
      chromeMocks.permissions.setRequestResult(true);
      chromeMocks.permissions.contains = () =>
        new Promise<boolean>((resolve) => {
          resolveContains = resolve;
          notifyContainsStarted();
        });
      try {
        const enabling = dispatchMessage({ type, payload: { enabled: true } }, trustedPopup());
        await containsStarted;
        const disabled = await dispatchMessage({ type, payload: { enabled: false } }, trustedPopup());
        expect(disabled.success).toBe(true);
        resolveContains(true);
        expect(await enabling).toMatchObject({
          success: false,
          error: 'Setting changed while permission was pending',
        });
        expect(getAppStateFromStorage()[key]).toBe(false);
      } finally {
        chromeMocks.permissions.contains = originalContains;
      }
    });
  }

  test('invalid payloads and untrusted senders never request optional permissions', async () => {
    const listener = chromeMocks.runtime.onMessage._handlers[0];
    if (!listener) throw new Error('service worker onMessage handler not registered');
    const invalid = await new Promise<unknown>((resolve) => {
      listener({ type: 'SET_NOTIFICATIONS_ENABLED', payload: { enabled: 'yes' } }, trustedPopup(), resolve);
    });
    expect(invalid).toMatchObject({ success: false, error: 'Invalid message payload' });
    expect(chromeMocks.permissions._requests).toHaveLength(0);

    for (const sender of [
      {},
      { id: 'another-extension', url: chromeMocks.runtime.getURL('/popup.html') },
      { id: chromeMocks.runtime.id, url: 'https://www.twitch.tv/drops/campaigns' },
    ]) {
      for (const [type] of settings) {
        const response = await dispatchMessage({ type, payload: { enabled: true } }, sender);
        expect(response.success).toBe(false);
      }
    }
    expect(chromeMocks.permissions._requests).toHaveLength(0);
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);
  });

  test('pending permission consent prevents a backup import from starting', async () => {
    const originalRequest = chromeMocks.permissions.request;
    let accept: (value: boolean) => void = () => undefined;
    let requested = false;
    chromeMocks.permissions.request = () => {
      requested = true;
      return new Promise<boolean>((resolve) => {
        accept = resolve;
      });
    };
    try {
      const enabling = dispatchMessage(
        { type: 'SET_NOTIFICATIONS_ENABLED', payload: { enabled: true } },
        trustedPopup(),
      );
      expect(requested).toBe(true);
      const backup = exportBackup(getAppStateFromStorage(), [], '4.0.0');
      const imported = await dispatchMessage({
        type: 'IMPORT_BACKUP',
        payload: {
          backup,
          options: { mode: 'merge', settings: 'local', sections: ['statistics'] },
          revision: '0'.repeat(64),
        },
      });
      expect(imported).toMatchObject({
        success: false,
        error: 'Error: Another action is in progress. Refresh the preview and try again.',
      });
      accept(false);
      await enabling;
    } finally {
      chromeMocks.permissions.request = originalRequest;
    }
  });

  for (const type of ['SET_TELEGRAM_CREDENTIALS', 'TEST_TELEGRAM_ALERTS'] as const) {
    test(`${type} starts Telegram host permission consent synchronously`, async () => {
      const originalRequest = chromeMocks.permissions.request;
      let requested = false;
      chromeMocks.permissions.request = (permission) => {
        chromeMocks.permissions._requests.push(permission);
        requested = true;
        return Promise.resolve(false);
      };
      try {
        const message =
          type === 'SET_TELEGRAM_CREDENTIALS'
            ? { type, payload: { botToken: '123456:abcdefghijklmnopqrstuvwxyzABCDEFGH', chatId: '123456' } }
            : { type };
        const response = dispatchMessage(message, trustedPopup());
        expect(requested).toBe(true);
        expect((await response).success).toBe(false);
        expect(chromeMocks.permissions._requests[0]?.origins).toContain('https://api.telegram.org/*');
      } finally {
        chromeMocks.permissions.request = originalRequest;
      }
    });
  }
}
