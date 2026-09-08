import type {
  AutomationNotificationPayload,
  AutomationNotificationPersistence,
  AutomationNotificationResult,
} from './notifications.ts';
import type { TelegramSystemEventReason } from './telegram-notifications.ts';

export type AutomationEventNotification = AutomationNotificationPayload & {
  readonly telegramReason: TelegramSystemEventReason;
};

export interface AutomationEventNotifier {
  notify(notification: AutomationEventNotification): Promise<void>;
}

interface AutomationEventNotifierDependencies {
  readonly notifyBrowser: (
    notification: AutomationNotificationPayload,
  ) => Promise<AutomationNotificationResult>;
  readonly notifyTelegram: (reason: TelegramSystemEventReason, message: string) => Promise<boolean>;
  readonly persistence: AutomationNotificationPersistence;
}

function eventKey(notification: AutomationEventNotification): string {
  return notification.transitionId;
}

export function createAutomationEventNotifier(
  dependencies: AutomationEventNotifierDependencies,
): AutomationEventNotifier {
  const pending = new Map<string, Promise<void>>();

  const notify = async (notification: AutomationEventNotification): Promise<void> => {
    const key = eventKey(notification);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const delivery = Promise.allSettled([
      notifyBrowserOnce(notification),
      notifyTelegramOnce(notification),
    ]).then(() => undefined);
    pending.set(key, delivery);
    try {
      await delivery;
    } finally {
      if (pending.get(key) === delivery) pending.delete(key);
    }
  };

  async function notifyBrowserOnce(notification: AutomationEventNotification): Promise<void> {
    const key = `browser:${eventKey(notification)}`;
    if (await dependencies.persistence.hasSeen(key)) return;
    const result = await dependencies.notifyBrowser(notification);
    if (result.shown) await dependencies.persistence.markSeen(key);
  }

  async function notifyTelegramOnce(notification: AutomationEventNotification): Promise<void> {
    const key = `telegram:${eventKey(notification)}`;
    if (await dependencies.persistence.hasSeen(key)) return;
    const sent = await dependencies.notifyTelegram(notification.telegramReason, notification.message);
    if (sent) await dependencies.persistence.markSeen(key);
  }

  return { notify };
}
