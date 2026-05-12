import type { AppState } from '../types';

export const NOTIFICATION_PERMISSION: chrome.permissions.Permissions = {
  permissions: ['notifications'],
};

interface NotificationState {
  appState: Pick<AppState, 'notificationsEnabled'>;
}

interface NotificationControllerOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains'>;
  notificationsApi?: Pick<typeof chrome.notifications, 'create'>;
  saveState: () => Promise<unknown> | unknown;
}

export function createNotificationController(
  state: NotificationState,
  options: NotificationControllerOptions,
) {
  const permissionsApi = options.permissionsApi ?? chrome.permissions;
  const notificationsApi = options.notificationsApi ?? chrome.notifications;

  const hasNotificationPermission = async (): Promise<boolean> => {
    try {
      return await permissionsApi.contains(NOTIFICATION_PERMISSION);
    } catch {
      return false;
    }
  };

  const syncPermissionState = async () => {
    if (!state.appState.notificationsEnabled) {
      return;
    }
    if (await hasNotificationPermission()) {
      return;
    }
    state.appState.notificationsEnabled = false;
    await options.saveState();
  };

  const notify = async (title: string, message: string, priority = 2) => {
    if (!state.appState.notificationsEnabled) {
      return;
    }
    if (!(await hasNotificationPermission())) {
      state.appState.notificationsEnabled = false;
      await options.saveState();
      return;
    }
    await notificationsApi.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority,
    });
  };

  return {
    hasNotificationPermission,
    notify,
    syncPermissionState,
  };
}
