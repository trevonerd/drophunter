import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import type { AutomationNotificationEvent } from './automation-notification-events.ts';
import {
  AUTOMATION_NOTIFICATION_ID_PREFIX,
  createNotificationApiResolver,
  type NotificationApi,
} from './notification-actions.ts';

export {
  AUTOMATION_NOTIFICATION_EVENTS,
  type AutomationNotificationEvent,
} from './automation-notification-events.ts';
export type { NotificationApi } from './notification-actions.ts';

export const NOTIFICATION_PERMISSION: chrome.permissions.Permissions = {
  permissions: ['notifications'],
};

const QUEUE_COMPLETE_NOTIFICATION_ID = 'drophunter-queue-complete';

export interface AutomationNotificationPayload {
  readonly transitionId: string;
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

export interface AutomationNotificationResult {
  readonly shown: boolean;
  readonly deduplicated: boolean;
  readonly notificationId?: string;
}

export function getAutomationNotificationKey(
  event: AutomationNotificationEvent,
  campaignId: string,
  transitionId: string,
): string {
  return `${event}:${campaignId}:${transitionId}`;
}

export function getAutomationNotificationId(
  event: AutomationNotificationEvent,
  campaignId: string,
  transitionId: string,
): string {
  return `${AUTOMATION_NOTIFICATION_ID_PREFIX}-${event}-${encodeURIComponent(campaignId)}-${encodeURIComponent(transitionId)}`;
}

interface NotificationState {
  appState: Pick<AppState, 'notificationsEnabled'>;
}

interface NotificationControllerOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains'>;
  notificationsApi?: NotificationApi;
  saveState: () => Promise<unknown> | unknown;
  automationNotificationPersistence?: AutomationNotificationPersistence;
  openDropHunter?: () => Promise<unknown> | unknown;
  openTwitchDrops?: () => Promise<unknown> | unknown;
  pauseFarming?: () => Promise<unknown> | unknown;
}

export function createNotificationController(
  state: NotificationState,
  options: NotificationControllerOptions,
) {
  const permissionsApi = options.permissionsApi ?? browser.permissions;
  const seenAutomationNotifications = new Set<string>();
  const pendingAutomationNotifications = new Map<string, Promise<AutomationNotificationResult>>();
  const resolveNotificationsApi = createNotificationApiResolver(options);
  resolveNotificationsApi();

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

  const notifyQueueComplete = async (title: string, message: string) => {
    if (!state.appState.notificationsEnabled) {
      return;
    }
    if (!(await hasNotificationPermission())) {
      state.appState.notificationsEnabled = false;
      await options.saveState();
      return;
    }
    const notificationsApi = resolveNotificationsApi();
    if (!notificationsApi) {
      return;
    }
    await notificationsApi.create(QUEUE_COMPLETE_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 2,
    });
  };

  const clearQueueCompleteNotification = async () => {
    const notificationsApi = resolveNotificationsApi();
    if (!notificationsApi?.clear) {
      return;
    }
    try {
      await notificationsApi.clear(QUEUE_COMPLETE_NOTIFICATION_ID);
    } catch {
      // Browser notification cleanup is best-effort and must not block campaign validation.
    }
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
    const key = getAutomationNotificationKey(payload.event, payload.campaignId, payload.transitionId);
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
        await options.saveState();
        return { shown: false, deduplicated: false };
      }
      const notificationsApi = resolveNotificationsApi();
      if (!notificationsApi) {
        return { shown: false, deduplicated: false };
      }

      const notificationId = getAutomationNotificationId(
        payload.event,
        payload.campaignId,
        payload.transitionId,
      );
      await notificationsApi.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: payload.title,
        message: payload.message,
        priority: payload.priority ?? 2,
        buttons: [
          { title: payload.event === 'sign-in-required' ? 'Open Twitch Drops' : 'Open DropHunter' },
          { title: 'Pause' },
        ],
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
    notifyQueueComplete,
    clearQueueCompleteNotification,
    notifyAutomation,
    syncPermissionState,
    setNotificationsEnabled,
  };
}
