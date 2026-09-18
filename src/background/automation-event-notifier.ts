import type { AutomationNotificationPayload, AutomationNotificationResult } from './notifications.ts';
import type { TelegramSystemEventReason } from './telegram-notifications.ts';

export type AutomationEventNotification = AutomationNotificationPayload & {
  readonly telegramReason: TelegramSystemEventReason;
};

export interface AutomationEventNotifier {
  notify(notification: AutomationEventNotification): Promise<void>;
}

export interface AutomationNotificationPersistence {
  hasSeen(key: string): Promise<boolean> | boolean;
  markSeen(key: string): Promise<void> | void;
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
  const delivered = new Set<string>();
  const pendingReceipts = new Set<string>();

  async function persistDelivery(key: string): Promise<void> {
    delivered.add(key);
    pendingReceipts.add(key);
    await dependencies.persistence.markSeen(key);
    pendingReceipts.delete(key);
  }

  async function hasDelivered(key: string): Promise<boolean> {
    if (pendingReceipts.has(key)) await persistDelivery(key);
    return delivered.has(key) || (await dependencies.persistence.hasSeen(key));
  }

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
    if (await hasDelivered(key)) return;
    const result = await dependencies.notifyBrowser(notification);
    if (result.shown || result.deduplicated) {
      await persistDelivery(key);
    }
  }

  async function notifyTelegramOnce(notification: AutomationEventNotification): Promise<void> {
    const key = `telegram:${eventKey(notification)}`;
    if (await hasDelivered(key)) return;
    const sent = await dependencies.notifyTelegram(notification.telegramReason, notification.message);
    if (sent) {
      await persistDelivery(key);
    }
  }

  return { notify };
}
