import { describe, expect, test } from 'bun:test';
import { createNotificationController } from '../src/background/notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';

function createChromeNotificationFakes(permissionGranted: boolean) {
  const notifications: unknown[] = [];
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
      async create(options: chrome.notifications.NotificationOptions<true>) {
        notifications.push(options);
        return 'notification-id';
      },
    },
    permissionChecks,
  };
}

describe('notification controller', () => {
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

  test('disables notification preference when optional permission is missing', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
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
