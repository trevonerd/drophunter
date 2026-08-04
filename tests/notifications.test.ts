import { describe, expect, test } from 'bun:test';
import {
  type AutomationNotificationEvent,
  createNotificationController,
  getAutomationNotificationId,
} from '../src/background/notifications.ts';
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

  test('disables notification preference when optional permission is missing', async () => {
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
    expect(state.appState.autoStartFavoriteGames).toBe(false);
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

interface AutomationNotificationRecord {
  id: string;
  options: chrome.notifications.NotificationCreateOptions;
}

function createAutomationNotificationFakes(permissionGranted: boolean) {
  const records: AutomationNotificationRecord[] = [];
  const clickedListeners: Array<(notificationId: string) => void> = [];
  const buttonClickedListeners: Array<(notificationId: string, buttonIndex: number) => void> = [];

  return {
    records,
    clickedListeners,
    buttonClickedListeners,
    permissionsApi: {
      async contains() {
        return permissionGranted;
      },
    },
    notificationsApi: {
      async create(
        notificationIdOrOptions: string | chrome.notifications.NotificationCreateOptions,
        maybeOptions?: chrome.notifications.NotificationCreateOptions,
      ) {
        const id = typeof notificationIdOrOptions === 'string' ? notificationIdOrOptions : 'generated-id';
        const options = typeof notificationIdOrOptions === 'string' ? maybeOptions : notificationIdOrOptions;
        if (!options) {
          throw new Error('Notification options are required');
        }
        records.push({ id, options });
        return id;
      },
      onClicked: {
        addListener(listener: (notificationId: string) => void) {
          clickedListeners.push(listener);
        },
      },
      onButtonClicked: {
        addListener(listener: (notificationId: string, buttonIndex: number) => void) {
          buttonClickedListeners.push(listener);
        },
      },
    },
  };
}

function createAutomationPayload(event: AutomationNotificationEvent, campaignId = 'campaign-1') {
  return {
    event,
    campaignId,
    title: 'DropHunter started Cyberpunk 2077',
    message: 'Phantom Liberty Rewards · Next reward in 30m · Ends in 8h',
  };
}

describe('automation notifications', () => {
  test('creates a stable actionable notification for a campaign transition', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const persistedKeys: string[] = [];
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      automationNotificationPersistence: {
        async hasSeen() {
          return false;
        },
        async markSeen(key) {
          persistedKeys.push(key);
        },
      },
    });

    const result = await controller.notifyAutomation(createAutomationPayload('start'));

    expect(result).toEqual({
      shown: true,
      deduplicated: false,
      notificationId: getAutomationNotificationId('start', 'campaign-1'),
    });
    expect(fakes.records).toEqual([
      {
        id: 'drophunter-automation-start-campaign-1',
        options: {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'DropHunter started Cyberpunk 2077',
          message: 'Phantom Liberty Rewards · Next reward in 30m · Ends in 8h',
          priority: 2,
          buttons: [{ title: 'Open DropHunter' }, { title: 'Pause' }],
        },
      },
    ]);
    expect(persistedKeys).toEqual(['start:campaign-1']);
  });

  test('deduplicates persisted transitions and coalesces simultaneous evaluations', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const seen = new Set<string>();
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      automationNotificationPersistence: {
        async hasSeen(key) {
          return seen.has(key);
        },
        async markSeen(key) {
          seen.add(key);
        },
      },
    });
    const payload = createAutomationPayload('favorite-added');

    const [first, second] = await Promise.all([
      controller.notifyAutomation(payload),
      controller.notifyAutomation(payload),
    ]);
    const third = await controller.notifyAutomation(payload);

    expect(first).toEqual({
      shown: true,
      deduplicated: false,
      notificationId: getAutomationNotificationId('favorite-added', 'campaign-1'),
    });
    expect(second).toEqual(first);
    expect(third).toEqual({ shown: false, deduplicated: true });
    expect(fakes.records).toHaveLength(1);
    expect(seen).toEqual(new Set(['favorite-added:campaign-1']));
  });

  test('routes notification clicks and actions to injected hooks', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const actions: string[] = [];
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      openDropHunter: async () => {
        actions.push('open');
      },
      pauseFarming: async () => {
        actions.push('pause');
      },
    });
    const payload = createAutomationPayload('preemption', 'campaign-2');
    const notificationId = getAutomationNotificationId(payload.event, payload.campaignId);

    await controller.notifyAutomation(payload);
    fakes.clickedListeners[0]?.(notificationId);
    fakes.buttonClickedListeners[0]?.(notificationId, 0);
    fakes.buttonClickedListeners[0]?.(notificationId, 1);
    fakes.buttonClickedListeners[0]?.(notificationId, 2);
    await Promise.resolve();

    expect(actions).toEqual(['open', 'open', 'pause']);
  });

  test('disables automation notification preference when permission is revoked', async () => {
    const state = {
      appState: {
        ...createInitialState(),
        notificationsEnabled: true,
        autoStartFavoriteGames: true,
      },
    };
    const fakes = createAutomationNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    const result = await controller.notifyAutomation(createAutomationPayload('preemption'));

    expect(result).toEqual({ shown: false, deduplicated: false });
    expect(state.appState.notificationsEnabled).toBe(false);
    expect(state.appState.autoStartFavoriteGames).toBe(false);
    expect(saveCount).toBe(1);
    expect(fakes.records).toEqual([]);
  });

  test('clears auto-start when a revoked permission is detected during a state sync', async () => {
    const state = {
      appState: {
        ...createInitialState(),
        notificationsEnabled: false,
        autoStartFavoriteGames: true,
      },
    };
    const fakes = createAutomationNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    await controller.syncPermissionState();

    expect(state.appState.autoStartFavoriteGames).toBe(false);
    expect(saveCount).toBe(1);
  });
});
