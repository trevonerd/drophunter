import type { AutomationNotificationEvent } from '../../src/background/notifications.ts';

interface AutomationNotificationRecord {
  id: string;
  options: chrome.notifications.NotificationCreateOptions;
}

export function createAutomationNotificationFakes(permissionGranted: boolean) {
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
        if (!options) throw new Error('Notification options are required');
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

export function createAutomationPayload(
  event: AutomationNotificationEvent,
  campaignId = 'campaign-1',
  transitionId = `${event}:${campaignId}:1`,
) {
  return {
    transitionId,
    event,
    campaignId,
    title: 'DropHunter started Cyberpunk 2077',
    message: 'Phantom Liberty Rewards · Next reward in 30m · Ends in 8h',
  };
}
