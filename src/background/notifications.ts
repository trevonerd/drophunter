import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';

export const NOTIFICATION_PERMISSION: chrome.permissions.Permissions = {
  permissions: ['notifications'],
};

export const AUTOMATION_NOTIFICATION_EVENTS = [
  'start',
  'favorite-added',
  'preemption',
  'unfarmable',
] as const;
export type AutomationNotificationEvent = (typeof AUTOMATION_NOTIFICATION_EVENTS)[number];

const AUTOMATION_NOTIFICATION_ID_PREFIX = 'drophunter-automation';

export interface AutomationNotificationPayload {
  readonly event: AutomationNotificationEvent;
  readonly campaignId: string;
  readonly title: string;
  readonly message: string;
  readonly priority?: number;
}

export interface AutomationNotificationPersistence {
  hasSeen(key: string): Promise<boolean> | boolean;
  markSeen(key: string): Promise<void> | void;
}

interface NotificationEvent<Args extends readonly unknown[]> {
  addListener(listener: (...args: Args) => void): void;
}

export interface NotificationApi {
  create(
    notificationIdOrOptions: string | chrome.notifications.NotificationCreateOptions,
    options?: chrome.notifications.NotificationCreateOptions,
  ): Promise<string>;
  onClicked?: NotificationEvent<[notificationId: string]>;
  onButtonClicked?: NotificationEvent<[notificationId: string, buttonIndex: number]>;
}

export interface AutomationNotificationResult {
  readonly shown: boolean;
  readonly deduplicated: boolean;
  readonly notificationId?: string;
}

export function getAutomationNotificationKey(event: AutomationNotificationEvent, campaignId: string): string {
  return `${event}:${campaignId}`;
}

export function getAutomationNotificationId(event: AutomationNotificationEvent, campaignId: string): string {
  return `${AUTOMATION_NOTIFICATION_ID_PREFIX}-${event}-${encodeURIComponent(campaignId)}`;
}

interface NotificationState {
  appState: Pick<AppState, 'notificationsEnabled' | 'autoStartFavoriteGames'>;
}

interface NotificationControllerOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains'>;
  notificationsApi?: NotificationApi;
  saveState: () => Promise<unknown> | unknown;
  automationNotificationPersistence?: AutomationNotificationPersistence;
  openDropHunter?: () => Promise<unknown> | unknown;
  pauseFarming?: () => Promise<unknown> | unknown;
}

export function createNotificationController(
  state: NotificationState,
  options: NotificationControllerOptions,
) {
  const permissionsApi = options.permissionsApi ?? browser.permissions;
  const seenAutomationNotifications = new Set<string>();
  const pendingAutomationNotifications = new Map<string, Promise<AutomationNotificationResult>>();
  const boundNotificationApis = new WeakSet<NotificationApi>();

  const isAutomationNotificationId = (notificationId: string): boolean =>
    notificationId.startsWith(`${AUTOMATION_NOTIFICATION_ID_PREFIX}-`);

  const invokeAction = (action: (() => Promise<unknown> | unknown) | undefined): void => {
    if (!action) {
      return;
    }
    void Promise.resolve()
      .then(action)
      .catch(() => undefined);
  };

  const bindNotificationActions = (notificationsApi: NotificationApi): void => {
    if (boundNotificationApis.has(notificationsApi)) {
      return;
    }
    boundNotificationApis.add(notificationsApi);
    if (notificationsApi.onClicked && options.openDropHunter) {
      notificationsApi.onClicked.addListener((notificationId) => {
        if (isAutomationNotificationId(notificationId)) {
          invokeAction(options.openDropHunter);
        }
      });
    }
    if (notificationsApi.onButtonClicked) {
      notificationsApi.onButtonClicked.addListener((notificationId, buttonIndex) => {
        if (!isAutomationNotificationId(notificationId)) {
          return;
        }
        if (buttonIndex === 0) {
          invokeAction(options.openDropHunter);
        } else if (buttonIndex === 1) {
          invokeAction(options.pauseFarming);
        }
      });
    }
  };

  const resolveNotificationsApi = (): NotificationApi | undefined => {
    const notificationsApi: NotificationApi | undefined = options.notificationsApi ?? browser.notifications;
    if (notificationsApi) {
      bindNotificationActions(notificationsApi);
    }
    return notificationsApi;
  };

  const hasNotificationPermission = async (): Promise<boolean> => {
    try {
      return await permissionsApi.contains(NOTIFICATION_PERMISSION);
    } catch {
      return false;
    }
  };

  const syncPermissionState = async () => {
    if (!state.appState.notificationsEnabled && !state.appState.autoStartFavoriteGames) {
      return;
    }
    if (await hasNotificationPermission()) {
      return;
    }
    state.appState.notificationsEnabled = false;
    state.appState.autoStartFavoriteGames = false;
    await options.saveState();
  };

  const notify = async (title: string, message: string, priority = 2) => {
    if (!state.appState.notificationsEnabled) {
      return;
    }
    if (!(await hasNotificationPermission())) {
      state.appState.notificationsEnabled = false;
      state.appState.autoStartFavoriteGames = false;
      await options.saveState();
      return;
    }
    const notificationsApi = resolveNotificationsApi();
    if (!notificationsApi) {
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
    resolveNotificationsApi();
    state.appState.notificationsEnabled = true;
    await options.saveState();
    return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
  };

  const notifyAutomation = async (
    payload: AutomationNotificationPayload,
  ): Promise<AutomationNotificationResult> => {
    const key = getAutomationNotificationKey(payload.event, payload.campaignId);
    const pending = pendingAutomationNotifications.get(key);
    if (pending) {
      return pending;
    }

    const evaluation = (async (): Promise<AutomationNotificationResult> => {
      if (!state.appState.notificationsEnabled) {
        return { shown: false, deduplicated: false };
      }
      if (
        seenAutomationNotifications.has(key) ||
        (await options.automationNotificationPersistence?.hasSeen(key))
      ) {
        seenAutomationNotifications.add(key);
        return { shown: false, deduplicated: true };
      }
      if (!(await hasNotificationPermission())) {
        state.appState.notificationsEnabled = false;
        state.appState.autoStartFavoriteGames = false;
        await options.saveState();
        return { shown: false, deduplicated: false };
      }
      const notificationsApi = resolveNotificationsApi();
      if (!notificationsApi) {
        return { shown: false, deduplicated: false };
      }

      const notificationId = getAutomationNotificationId(payload.event, payload.campaignId);
      await notificationsApi.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: payload.title,
        message: payload.message,
        priority: payload.priority ?? 2,
        buttons: [{ title: 'Open DropHunter' }, { title: 'Pause' }],
      });
      seenAutomationNotifications.add(key);
      await options.automationNotificationPersistence?.markSeen(key);
      return { shown: true, deduplicated: false, notificationId };
    })();

    pendingAutomationNotifications.set(key, evaluation);
    void evaluation.then(
      () => {
        if (pendingAutomationNotifications.get(key) === evaluation) {
          pendingAutomationNotifications.delete(key);
        }
      },
      () => {
        if (pendingAutomationNotifications.get(key) === evaluation) {
          pendingAutomationNotifications.delete(key);
        }
      },
    );
    return evaluation;
  };

  return {
    hasNotificationPermission,
    notify,
    notifyAutomation,
    syncPermissionState,
    setNotificationsEnabled,
  };
}
