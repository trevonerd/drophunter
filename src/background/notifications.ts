import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';

const AUTOMATION_NOTIFICATION_EVENTS = [
  'discovery',
  'start',
  'preemption',
  'manual-suspended',
  'manual-resumed',
  'recovery',
  'exclusion',
  'completion',
  'sign-in-required',
  'unfarmable',
  'queue-cleanup',
] as const;

export type AutomationNotificationEvent = (typeof AUTOMATION_NOTIFICATION_EVENTS)[number];

const AUTOMATION_NOTIFICATION_ID_PREFIX = 'drophunter-automation';

interface NotificationEvent<Args extends readonly unknown[]> {
  addListener(listener: (...args: Args) => void): void;
}

export interface NotificationApi {
  create(
    notificationIdOrOptions: string | chrome.notifications.NotificationCreateOptions,
    options?: chrome.notifications.NotificationCreateOptions,
  ): Promise<string>;
  clear?(notificationId: string): Promise<boolean>;
  onClicked?: NotificationEvent<[notificationId: string]>;
  onButtonClicked?: NotificationEvent<[notificationId: string, buttonIndex: number]>;
}

interface NotificationActionOptions {
  readonly notificationsApi?: NotificationApi;
  readonly openDropHunter?: () => Promise<unknown> | unknown;
  readonly openTwitchDrops?: () => Promise<unknown> | unknown;
  readonly pauseFarming?: () => Promise<unknown> | unknown;
}

function createNotificationApiResolver(options: NotificationActionOptions) {
  const boundNotificationApis = new WeakSet<NotificationApi>();

  const isAutomationNotificationId = (notificationId: string): boolean =>
    notificationId.startsWith(`${AUTOMATION_NOTIFICATION_ID_PREFIX}-`);

  const openNotification = (notificationId: string): void => {
    const isSignInRequired = notificationId.startsWith(
      `${AUTOMATION_NOTIFICATION_ID_PREFIX}-sign-in-required-`,
    );
    invokeAction(
      isSignInRequired ? (options.openTwitchDrops ?? options.openDropHunter) : options.openDropHunter,
    );
  };

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
    if (notificationsApi.onClicked && (options.openDropHunter || options.openTwitchDrops)) {
      notificationsApi.onClicked.addListener((notificationId) => {
        if (isAutomationNotificationId(notificationId)) {
          openNotification(notificationId);
        }
      });
    }
    if (notificationsApi.onButtonClicked) {
      notificationsApi.onButtonClicked.addListener((notificationId, buttonIndex) => {
        if (!isAutomationNotificationId(notificationId)) {
          return;
        }
        if (buttonIndex === 0) {
          openNotification(notificationId);
        } else if (buttonIndex === 1) {
          invokeAction(options.pauseFarming);
        }
      });
    }
  };

  return (): NotificationApi | undefined => {
    const notificationsApi: NotificationApi | undefined = options.notificationsApi ?? browser.notifications;
    if (notificationsApi) {
      bindNotificationActions(notificationsApi);
    }
    return notificationsApi;
  };
}

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

export interface AutomationNotificationResult {
  readonly shown: boolean;
  readonly deduplicated: boolean;
  readonly notificationId?: string;
}

/** cyrb53: deterministic 53-bit hash, enough to keep notification ids unique and short. */
function hashNotificationKey(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function getAutomationNotificationId(
  event: AutomationNotificationEvent,
  campaignId: string,
  transitionId: string,
): string {
  // Chrome rejects ids over 500 chars; campaign keys can embed long, percent-expanded names.
  return `${AUTOMATION_NOTIFICATION_ID_PREFIX}-${event}-${hashNotificationKey(`${campaignId}\0${transitionId}`)}`;
}

interface NotificationState {
  appState: Pick<AppState, 'notificationsEnabled'>;
}

interface NotificationControllerOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains'>;
  notificationsApi?: NotificationApi;
  saveState: (enabled: boolean, isCurrent?: () => boolean) => Promise<unknown> | unknown;
  openDropHunter?: () => Promise<unknown> | unknown;
  openTwitchDrops?: () => Promise<unknown> | unknown;
  pauseFarming?: () => Promise<unknown> | unknown;
}

export function createNotificationController(
  state: NotificationState,
  options: NotificationControllerOptions,
) {
  const permissionsApi = options.permissionsApi ?? browser.permissions;
  const resolveNotificationsApi = createNotificationApiResolver(options);
  resolveNotificationsApi();

  const saveEnabled = async (enabled: boolean, isCurrent: () => boolean = () => true) => {
    await options.saveState(enabled, isCurrent);
    if (isCurrent()) state.appState.notificationsEnabled = enabled;
  };

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
    await saveEnabled(false);
  };

  const notify = async (title: string, message: string, priority = 2) => {
    if (!state.appState.notificationsEnabled) {
      return;
    }
    if (!(await hasNotificationPermission())) {
      await saveEnabled(false);
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
      await saveEnabled(false);
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
    isCurrent: () => boolean = () => true,
  ): Promise<{ success: boolean; notificationsEnabled: boolean; error?: string }> => {
    if (!enabled) {
      await saveEnabled(false, isCurrent);
      return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
    }
    const granted = await hasNotificationPermission();
    if (!isCurrent())
      return {
        success: false,
        notificationsEnabled: state.appState.notificationsEnabled,
        error: 'Setting changed while permission was pending',
      };
    if (!granted) {
      await saveEnabled(false, isCurrent);
      return {
        success: false,
        notificationsEnabled: state.appState.notificationsEnabled,
        error: 'Notification permission was not granted',
      };
    }
    resolveNotificationsApi();
    await saveEnabled(true, isCurrent);
    return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
  };

  const notifyAutomation = async (
    payload: AutomationNotificationPayload,
  ): Promise<AutomationNotificationResult> => {
    if (!state.appState.notificationsEnabled) {
      return { shown: false, deduplicated: false };
    }
    if (!(await hasNotificationPermission())) {
      await saveEnabled(false);
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
    return { shown: true, deduplicated: false, notificationId };
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
