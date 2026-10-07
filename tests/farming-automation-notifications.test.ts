import { expect, test } from 'bun:test';
import {
  type AutomationEventNotification,
  createAutomationEventNotifier,
} from '../src/background/automation-event-notifier.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';

test.each([false, true])(
  'unfinished external delivery does not hold scheduler evaluations (manual: %s)',
  async (manual) => {
    let deliveries = 0;
    const subject = fixture('priority-list-only', {
      manual,
      automationNotify: {
        notify: async () => {
          deliveries++;
          await new Promise<void>(() => {});
        },
      },
    });
    const outcome = await subject.automation.request('campaign-refresh');
    expect(outcome.kind).toBe(manual ? 'unchanged' : 'started');
    expect(deliveries).toBeGreaterThan(0);
    const next = await subject.automation.request('periodic');
    expect(next.kind).toBe('unchanged');
  },
);

test('sends one favorite auto-start alert per destination across overlapping evaluations', async () => {
  const deliveries: string[] = [];
  const subject = fixture('priority-list-only', {
    automationNotify: createAutomationEventNotifier({
      notifyBrowser: async ({ event }) => {
        deliveries.push(`browser:${event}`);
        return { shown: true, deduplicated: false };
      },
      notifyTelegram: async (reason) => {
        deliveries.push(`telegram:${reason}`);
        return true;
      },
      persistence: { hasSeen: () => false, markSeen: () => undefined },
    }),
  });

  await Promise.all([
    subject.automation.request('campaign-refresh'),
    subject.automation.request('periodic'),
    subject.automation.request('periodic'),
  ]);

  expect(deliveries).toEqual(['browser:start', 'telegram:auto-started']);
  expect(subject.state.appState.automationActivity.map(({ kind }) => kind)).toEqual([
    'auto-started',
    'favorite-added',
  ]);
});

test('keeps the favorite discovery alert when manual watching delays the start', async () => {
  const notifications: AutomationEventNotification[] = [];
  const subject = fixture('priority-list-only', {
    manual: true,
    automationNotify: {
      notify: async (notification) => {
        notifications.push(notification);
      },
    },
  });

  const outcome = await subject.automation.request('campaign-refresh');
  await subject.automation.request('periodic');

  expect(outcome).toMatchObject({ kind: 'unchanged', reason: 'manual-watch-active' });
  expect(notifications.map(({ event }) => event)).toEqual(['discovery']);
});

test('keeps the favorite discovery alert when stream preparation fails', async () => {
  const notifications: AutomationEventNotification[] = [];
  const subject = fixture('priority-list-only', {
    onPrepare: () => {
      throw new DOMException('No playback available', 'InvalidStateError');
    },
    automationNotify: {
      notify: async (notification) => {
        notifications.push(notification);
      },
    },
  });

  const outcome = await subject.automation.request('campaign-refresh');

  expect(outcome.kind).toBe('failed');
  expect(subject.state.appState.isRunning).toBe(false);
  expect(subject.state.appState.nextAutomationCheckAt).toBeGreaterThan(0);
  expect(notifications.map(({ event }) => event)).toEqual(['discovery']);
  expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
});
