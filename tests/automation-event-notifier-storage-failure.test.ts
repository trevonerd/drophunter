import { expect, test } from 'bun:test';
import {
  type AutomationEventNotification,
  createAutomationEventNotifier,
} from '../src/background/automation-event-notifier.ts';

const notification: AutomationEventNotification = {
  transitionId: 'favorite-added:campaign-one:100',
  event: 'discovery',
  campaignId: 'campaign-one',
  title: 'Favorite campaign available',
  message: 'Campaign one was queued.',
  telegramReason: 'favorite-discovered',
};

test('does not redeliver successful destinations when deduplication storage fails', async () => {
  const deliveries: string[] = [];
  const notifier = createAutomationEventNotifier({
    notifyBrowser: async () => {
      deliveries.push('browser');
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async () => {
      deliveries.push('telegram');
      return true;
    },
    persistence: {
      hasSeen: () => false,
      markSeen: () => {
        throw new DOMException('Storage unavailable', 'InvalidStateError');
      },
    },
  });

  await notifier.notify(notification);
  await notifier.notify(notification);

  expect(deliveries).toEqual(['browser', 'telegram']);
});

test('retries an undelivered destination without repeating the successful destination', async () => {
  const deliveries: string[] = [];
  let telegramAvailable = false;
  const notifier = createAutomationEventNotifier({
    notifyBrowser: async () => {
      deliveries.push('browser');
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async () => {
      deliveries.push('telegram');
      return telegramAvailable;
    },
    persistence: { hasSeen: () => false, markSeen: () => undefined },
  });

  await notifier.notify(notification);
  telegramAvailable = true;
  await notifier.notify(notification);
  await notifier.notify(notification);

  expect(deliveries).toEqual(['browser', 'telegram', 'telegram']);
});

test.each([
  'browser',
  'telegram',
  'both',
] as const)('repairs failed %s receipts before restart', async (failedDestination) => {
  const deliveries: string[] = [];
  const receipts = new Set<string>();
  let storageAvailable = false;
  const dependencies = {
    notifyBrowser: async () => {
      deliveries.push('browser');
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async () => {
      deliveries.push('telegram');
      return true;
    },
    persistence: {
      hasSeen: (key: string) => receipts.has(key),
      markSeen: (key: string) => {
        if (!storageAvailable && (failedDestination === 'both' || key.startsWith(failedDestination))) {
          throw new DOMException('Storage unavailable', 'InvalidStateError');
        }
        receipts.add(key);
      },
    },
  };
  const notifier = createAutomationEventNotifier(dependencies);

  await notifier.notify(notification);
  storageAvailable = true;
  await notifier.notify(notification);
  await createAutomationEventNotifier(dependencies).notify(notification);

  expect(deliveries).toEqual(['browser', 'telegram']);
  expect(receipts).toEqual(
    new Set([`browser:${notification.transitionId}`, `telegram:${notification.transitionId}`]),
  );
});
