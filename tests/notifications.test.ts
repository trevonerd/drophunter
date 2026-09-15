import { describe, expect, test } from 'bun:test';
import { createNotificationController } from '../src/background/notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';

function createChromeNotificationFakes(permissionGranted: boolean) {
  const notifications: unknown[] = [];
  const notificationIds: string[] = [];
  const cleared: string[] = [];
  const permissionChecks: chrome.permissions.Permissions[] = [];

  return {
    notifications,
    permissionsApi: {
      async contains(permissions: chrome.permissions.Permissions) {
        permissionChecks.push(permissions);
        return permissionGranted;
      },
    },
    notificationsApi: {
      async create(
        notificationIdOrOptions: string | chrome.notifications.NotificationOptions<true>,
        options?: chrome.notifications.NotificationOptions<true>,
      ) {
        const notificationOptions =
          typeof notificationIdOrOptions === 'string' ? options : notificationIdOrOptions;
        if (!notificationOptions) throw new TypeError('Notification options are required');
        if (typeof notificationIdOrOptions === 'string') notificationIds.push(notificationIdOrOptions);
        notifications.push(notificationOptions);
        return 'notification-id';
      },
      async clear(notificationId: string) {
        cleared.push(notificationId);
        return true;
      },
    },
    cleared,
    notificationIds,
    permissionChecks,
  };
}

describe('notification controller', () => {
  test('constructs when the optional notifications API is unavailable', () => {
    const originalChrome = Reflect.get(globalThis, 'chrome');
    Reflect.set(globalThis, 'chrome', { notifications: undefined });
    try {
      expect(() =>
        createNotificationController(
          { appState: { ...createInitialState(), notificationsEnabled: false } },
          {
            permissionsApi: { contains: async () => false },
            saveState: async () => {},
          },
        ),
      ).not.toThrow();
    } finally {
      if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
      else Reflect.set(globalThis, 'chrome', originalChrome);
    }
  });

  test('skips chrome notifications when the user preference is disabled', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: false } };
    const fakes = createChromeNotificationFakes(true);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    await controller.notify('Title', 'Message');

    expect(fakes.notifications).toEqual([]);
    expect(fakes.permissionChecks).toEqual([]);
    expect(saveCount).toBe(0);
  });

  test('disables only the notification preference when optional permission is missing', async () => {
    const state = {
      appState: {
        ...createInitialState(),
        notificationsEnabled: true,
        autoStartFavoriteGames: true,
      },
    };
    const fakes = createChromeNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    await controller.notify('Title', 'Message');

    expect(state.appState.notificationsEnabled).toBe(false);
    expect(state.appState.autoStartFavoriteGames).toBe(true);
    expect(fakes.notifications).toEqual([]);
    expect(saveCount).toBe(1);
  });

  test('creates a chrome notification when preference and permission are enabled', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createChromeNotificationFakes(true);
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
    });

    await controller.notify('Drop completed', 'Reward unlocked', 1);

    expect(fakes.notifications).toEqual([
      {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Drop completed',
        message: 'Reward unlocked',
        priority: 1,
      },
    ]);
  });

  test('creates and clears only the stable queue-complete notification', async () => {
    // Given a browser alert for a completed queue.
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createChromeNotificationFakes(true);
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
    });

    // When fresh Twitch validation contradicts the cached terminal transition.
    await controller.notifyQueueComplete('All drops completed', 'Queue completed. No pending rewards left.');
    await controller.clearQueueCompleteNotification();

    // Then only the queue-complete alert is retracted by its dedicated provenance ID.
    expect(fakes.notificationIds).toEqual(['drophunter-queue-complete']);
    expect(fakes.cleared).toEqual(['drophunter-queue-complete']);
  });
});

describe('notification controller setNotificationsEnabled', () => {
  test('disables the preference when the user turns it off', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createChromeNotificationFakes(true);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    const result = await controller.setNotificationsEnabled(false);

    expect(result).toEqual({ success: true, notificationsEnabled: false });
    expect(state.appState.notificationsEnabled).toBe(false);
    expect(saveCount).toBe(1);
    expect(fakes.notifications).toEqual([]);
  });

  test('enables the preference when permission is already granted', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: false } };
    const fakes = createChromeNotificationFakes(true);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    const result = await controller.setNotificationsEnabled(true);

    expect(result).toEqual({ success: true, notificationsEnabled: true });
    expect(state.appState.notificationsEnabled).toBe(true);
    expect(saveCount).toBe(1);
  });

  test('flips the preference off and surfaces an error when permission is missing', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: false } };
    const fakes = createChromeNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    const result = await controller.setNotificationsEnabled(true);

    expect(result.success).toBe(false);
    expect(result.notificationsEnabled).toBe(false);
    expect(result.error).toBe('Notification permission was not granted');
    expect(state.appState.notificationsEnabled).toBe(false);
    expect(saveCount).toBe(1);
    expect(fakes.notifications).toEqual([]);
  });
});
