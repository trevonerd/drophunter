import { browser } from '../shared/browser-api.ts';

export const AUTOMATION_NOTIFICATION_ID_PREFIX = 'drophunter-automation';

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

export function createNotificationApiResolver(options: NotificationActionOptions) {
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
