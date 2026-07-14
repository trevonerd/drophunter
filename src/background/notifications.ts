import { browser } from '../shared/browser-api.ts';
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
  const permissionsApi = options.permissionsApi ?? browser.permissions;
  const notificationsApi = options.notificationsApi ?? browser.notifications;

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

  // Owns the enable/disable policy: disabled short-circuits, enabled requires
  // the optional notification permission, otherwise flips the flag off and
  // surfaces the permission error. Caller owns the activity-side-effect.
  const setNotificationsEnabled = async (
    enabled: boolean,
  ): Promise<{ success: boolean; notificationsEnabled: boolean; error?: string }> => {
    if (!enabled) {
      state.appState.notificationsEnabled = false;
      await options.saveState();
      return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
    }
    if (!(await hasNotificationPermission())) {
      state.appState.notificationsEnabled = false;
      await options.saveState();
      return {
        success: false,
        notificationsEnabled: state.appState.notificationsEnabled,
        error: 'Notification permission was not granted',
      };
    }
    state.appState.notificationsEnabled = true;
    await options.saveState();
    return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
  };

  return {
    hasNotificationPermission,
    notify,
    syncPermissionState,
    setNotificationsEnabled,
  };
}
