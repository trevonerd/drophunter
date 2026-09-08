import { expect, test } from 'bun:test';
import { createAutomationEventNotifier } from '../src/background/automation-event-notifier.ts';

test('delivers an automatic transition independently to browser and Telegram', async () => {
  const deliveries: string[] = [];
  const seen = new Set<string>();
  const notifier = createAutomationEventNotifier({
    notifyBrowser: async ({ event }) => {
      deliveries.push(`browser:${event}`);
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async (reason) => {
      deliveries.push(`telegram:${reason}`);
      return true;
    },
    persistence: {
      hasSeen: async (key) => seen.has(key),
      markSeen: async (key) => {
        seen.add(key);
      },
    },
  });

  await notifier.notify({
    transitionId: 'discovery:campaign-1:100',
    event: 'discovery',
    campaignId: 'campaign-1',
    title: 'Favorite campaign available',
    message: 'Game campaign was discovered.',
    telegramReason: 'favorite-discovered',
  });

  expect(deliveries).toEqual(['browser:discovery', 'telegram:favorite-discovered']);
});

test('delivers separate transitions for the same event and campaign', async () => {
  const deliveries: string[] = [];
  const notifier = createAutomationEventNotifier({
    notifyBrowser: async ({ transitionId }) => {
      deliveries.push(`browser:${transitionId}`);
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async (_reason, message) => {
      deliveries.push(`telegram:${message}`);
      return true;
    },
    persistence: { hasSeen: async () => false, markSeen: async () => undefined },
  });

  await notifier.notify({
    transitionId: 'start:campaign-1:100',
    event: 'start',
    campaignId: 'campaign-1',
    title: 'Farming started',
    message: 'First start.',
    telegramReason: 'auto-started',
  });
  await notifier.notify({
    transitionId: 'start:campaign-1:200',
    event: 'start',
    campaignId: 'campaign-1',
    title: 'Farming started',
    message: 'Second start.',
    telegramReason: 'auto-started',
  });

  expect(deliveries).toEqual([
    'browser:start:campaign-1:100',
    'telegram:First start.',
    'browser:start:campaign-1:200',
    'telegram:Second start.',
  ]);
});

test('deduplicates a delivered transition after the notifier is reconstructed', async () => {
  const deliveries: string[] = [];
  const seen = new Set<string>();
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
      hasSeen: async (key: string) => seen.has(key),
      markSeen: async (key: string) => {
        seen.add(key);
      },
    },
  };
  const notification = {
    transitionId: 'recovery:campaign-1:100',
    event: 'recovery' as const,
    campaignId: 'campaign-1',
    title: 'Recovering farming',
    message: 'Trying another streamer.',
    telegramReason: 'recovery' as const,
  };

  await createAutomationEventNotifier(dependencies).notify(notification);
  await createAutomationEventNotifier(dependencies).notify(notification);

  expect(deliveries).toEqual(['browser', 'telegram']);
});

test('deduplicates a persisted transition per destination without marking a failed delivery', async () => {
  const deliveries: string[] = [];
  const seen = new Set<string>();
  const dependencies = {
    notifyBrowser: async () => {
      deliveries.push('browser');
      throw new Error('permission revoked');
    },
    notifyTelegram: async () => {
      deliveries.push('telegram');
      return true;
    },
    persistence: {
      hasSeen: async (key: string) => seen.has(key),
      markSeen: async (key: string) => {
        seen.add(key);
      },
    },
  };
  const notifier = createAutomationEventNotifier(dependencies);
  const notification = {
    transitionId: 'manual-suspended:campaign-1:100',
    event: 'manual-suspended' as const,
    campaignId: 'campaign-1',
    title: 'Manual viewing detected',
    message: 'Automation paused.',
    telegramReason: 'manual-suspended' as const,
  };

  await Promise.all([notifier.notify(notification), notifier.notify(notification)]);
  await createAutomationEventNotifier(dependencies).notify(notification);

  expect(deliveries).toEqual(['browser', 'telegram', 'browser']);
  expect(seen).toEqual(new Set(['telegram:manual-suspended:campaign-1:100']));
});
