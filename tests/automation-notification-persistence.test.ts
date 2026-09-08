import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AutomationEventNotification,
  createAutomationEventNotifier,
} from '../src/background/automation-event-notifier.ts';
import { automationNotificationPersistence } from '../src/background/automation-notification-persistence.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('automation notification persistence', () => {
  let mocks: ChromeMocks;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  test('persists and deduplicates transition keys across controller lifetimes', async () => {
    expect(await automationNotificationPersistence.hasSeen('start:campaign-a')).toBe(false);
    await automationNotificationPersistence.markSeen('start:campaign-a');
    await automationNotificationPersistence.markSeen('start:campaign-a');
    expect(await automationNotificationPersistence.hasSeen('start:campaign-a')).toBe(true);
    expect(mocks.storage.local._store.get('automationNotificationTransitions')).toEqual(['start:campaign-a']);
  });

  test('retains every destination receipt when delivery completes concurrently', async () => {
    const keys = ['browser:start:campaign-a', 'telegram:start:campaign-a', 'browser:discovery:campaign-b'];

    await Promise.all(keys.map((key) => automationNotificationPersistence.markSeen(key)));

    expect(mocks.storage.local._store.get('automationNotificationTransitions')).toEqual(keys);
    expect(await Promise.all(keys.map((key) => automationNotificationPersistence.hasSeen(key)))).toEqual([
      true,
      true,
      true,
    ]);
  });

  test('continues queued receipts after a failed write and permits retrying the failed receipt', async () => {
    const write = mocks.storage.local.set;
    let attempts = 0;
    mocks.storage.local.set = async (items) => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('Storage unavailable', 'InvalidStateError');
      await write(items);
    };

    const outcomes = await Promise.allSettled([
      automationNotificationPersistence.markSeen('browser:start:a'),
      automationNotificationPersistence.markSeen('telegram:start:a'),
    ]);
    await automationNotificationPersistence.markSeen('browser:start:a');

    expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
    expect(mocks.storage.local._store.get('automationNotificationTransitions')).toEqual([
      'telegram:start:a',
      'browser:start:a',
    ]);
  });

  test('does not repeat simultaneous browser and Telegram deliveries after worker reconstruction', async () => {
    const deliveries: string[] = [];
    const dependencies = {
      notifyBrowser: async () => {
        deliveries.push('browser');
        return { shown: true, deduplicated: false };
      },
      notifyTelegram: async () => {
        deliveries.push('telegram');
        return true;
      },
      persistence: automationNotificationPersistence,
    };
    const notification: AutomationEventNotification = {
      transitionId: 'start:campaign-a:100',
      campaignId: 'campaign-a',
      event: 'start',
      telegramReason: 'auto-started',
      title: 'Farming started',
      message: 'Campaign A started.',
    };

    await createAutomationEventNotifier(dependencies).notify(notification);
    await createAutomationEventNotifier(dependencies).notify(notification);

    expect(deliveries).toEqual(['browser', 'telegram']);
  });
});
