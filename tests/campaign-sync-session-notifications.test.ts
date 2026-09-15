import { describe, expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createAutomationEventNotifier } from '../src/background/automation-event-notifier.ts';
import { persistCampaignSyncState } from '../src/background/campaign-sync-state.ts';
import { createNotificationController } from '../src/background/notifications.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createAutomationNotificationFakes } from './support/automation-notification-fakes.ts';
import { flushMicrotasks } from './support/farming-automation-fixtures.ts';

function createSubject(permissionGranted = true) {
  const state = createServiceWorkerState();
  state.appState.notificationsEnabled = true;
  state.appState.autoStartFavoriteGames = false;
  state.appState.manualQueueAuthorized = true;
  state.appState.queue = [{ id: 'marvel', name: 'Marvel Rivals', campaignId: 'season-10' }];
  const fakes = createAutomationNotificationFakes(permissionGranted);
  const receipts = new Set<string>();
  const persistence = {
    hasSeen: (key: string) => receipts.has(key),
    markSeen: (key: string) => {
      receipts.add(key);
    },
  };
  const telegram: string[] = [];
  const makeCoordinator = () => {
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      automationNotificationPersistence: persistence,
    });
    const notifier = createAutomationEventNotifier({
      persistence,
      notifyBrowser: controller.notifyAutomation,
      notifyTelegram: async (reason) => {
        if (!state.appState.telegramAlertsEnabled || !state.appState.telegramSystemAlertsEnabled)
          return false;
        telegram.push(reason);
        return true;
      },
    });
    return createActivationSyncCoordinator({
      now: () => 10_000_000,
      getCampaignSyncState: () => state.appState.campaignSyncState,
      setCampaignSyncState: (next) =>
        persistCampaignSyncState(state, next, {
          save: async () => {},
          broadcast: () => {},
          notifyAutomation: notifier.notify,
        }),
      performSync: async () => ({ kind: 'needs-session' }),
    });
  };
  return { state, fakes, makeCoordinator, telegram };
}

describe('campaign validation session notifications', () => {
  test('routes persisted sign-in notification clicks and its primary action to Twitch Drops', async () => {
    const subject = createSubject();
    await subject.makeCoordinator().request('browser-start');
    await flushMicrotasks();
    const fakes = createAutomationNotificationFakes(true);
    const actions: string[] = [];
    createNotificationController(subject.state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      openDropHunter: () => {
        actions.push('monitor');
      },
      openTwitchDrops: () => {
        actions.push('drops');
      },
    });
    const notificationId = subject.fakes.records[0]?.id ?? '';
    fakes.clickedListeners[0]?.(notificationId);
    fakes.buttonClickedListeners[0]?.(notificationId, 0);
    await Promise.resolve();
    expect(actions).toEqual(['drops', 'drops']);
  });

  test('alerts an authorized waiting queue once across retries and worker reconstruction', async () => {
    // Given: a saved manual queue is waiting for Twitch session validation.
    const subject = createSubject();
    // When: validation fails repeatedly, including after reconstruction.
    await subject.makeCoordinator().request('browser-start');
    await subject.makeCoordinator().request('manual-retry');
    await flushMicrotasks();
    // Then: the existing notifier delivers one actionable notification for the episode.
    expect(subject.fakes.records).toHaveLength(1);
    expect(subject.fakes.records[0]?.options.message).toContain('Open Twitch Drops');
    expect(subject.fakes.records[0]?.options.buttons?.[0]?.title).toBe('Open Twitch Drops');
    expect(subject.telegram).toEqual([]);
  });

  test('respects denied browser permission and existing Telegram system preferences', async () => {
    const subject = createSubject(false);
    subject.state.appState.telegramAlertsEnabled = true;
    subject.state.appState.telegramSystemAlertsEnabled = true;
    await subject.makeCoordinator().request('browser-start');
    await subject.makeCoordinator().request('manual-retry');
    await flushMicrotasks();
    expect(subject.fakes.records).toEqual([]);
    expect(subject.state.appState.notificationsEnabled).toBe(false);
    expect(subject.telegram).toEqual(['sign-in-required']);
  });

  test('permits a new alert after a successful validation ends the previous session episode', async () => {
    const subject = createSubject();
    await subject.makeCoordinator().request('browser-start');
    const recovered = createActivationSyncCoordinator({
      now: () => 11_000_000,
      getCampaignSyncState: () => subject.state.appState.campaignSyncState,
      setCampaignSyncState: (next) =>
        persistCampaignSyncState(subject.state, next, {
          save: async () => {},
          broadcast: () => {},
        }),
      performSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });
    await recovered.request('auth-recovered');
    await subject.makeCoordinator().request('manual-retry');
    await flushMicrotasks();
    expect(subject.fakes.records).toHaveLength(2);
    expect(subject.fakes.records[0]?.id).not.toBe(subject.fakes.records[1]?.id);
  });

  test('suppresses a notification when the user stops while publication is being saved', async () => {
    const subject = createSubject();
    const events: string[] = [];
    const coordinator = createActivationSyncCoordinator({
      getCampaignSyncState: () => subject.state.appState.campaignSyncState,
      setCampaignSyncState: (next) =>
        persistCampaignSyncState(subject.state, next, {
          save: async () => {
            if (next.status === 'needs-session') subject.state.appState.lastStopReason = 'user-stop';
          },
          broadcast: () => {},
          notifyAutomation: async (notification) => {
            events.push(notification.event);
          },
        }),
      performSync: async () => ({ kind: 'needs-session' }),
    });
    await coordinator.request('browser-start');
    expect(events).toEqual([]);
  });

  test('alerts enabled favorites when no manual queue is authorized', async () => {
    const subject = createSubject();
    subject.state.appState.manualQueueAuthorized = false;
    subject.state.appState.autoStartFavoriteGames = true;
    subject.state.appState.favoriteGames = ['marvel'];
    await subject.makeCoordinator().request('browser-start');
    await flushMicrotasks();
    expect(subject.fakes.records).toHaveLength(1);
  });

  for (const mode of ['paused', 'user-stop', 'unauthorized', 'notifications-disabled'] as const) {
    test(`does not notify when ${mode}`, async () => {
      const subject = createSubject();
      if (mode === 'paused') subject.state.appState.isPaused = true;
      if (mode === 'user-stop') subject.state.appState.lastStopReason = 'user-stop';
      if (mode === 'unauthorized') subject.state.appState.manualQueueAuthorized = false;
      if (mode === 'notifications-disabled') subject.state.appState.notificationsEnabled = false;
      await subject.makeCoordinator().request('browser-start');
      expect(subject.fakes.records).toEqual([]);
    });
  }

  test('does not notify for transient network or integrity recovery', async () => {
    for (const errorKind of ['network', 'integrity'] as const) {
      const subject = createSubject();
      const notifications: string[] = [];
      const coordinator = createActivationSyncCoordinator({
        getCampaignSyncState: () => subject.state.appState.campaignSyncState,
        setCampaignSyncState: (next) =>
          persistCampaignSyncState(subject.state, next, {
            save: async () => {},
            broadcast: () => {},
            notifyAutomation: async (notification) => {
              notifications.push(notification.event);
            },
          }),
        performSync: async () => ({ kind: 'transient-error', errorKind, error: 'Retrying' }),
      });
      await coordinator.request('browser-start');
      expect(notifications).toEqual([]);
    }
  });

  test('asks for Twitch verification rather than login after confirmed integrity recovery failure', async () => {
    const subject = createSubject();
    const messages: string[] = [];
    await persistCampaignSyncState(
      subject.state,
      {
        ...subject.state.appState.campaignSyncState,
        status: 'needs-session',
        lastErrorKind: 'integrity',
      },
      {
        save: async () => {},
        broadcast: () => {},
        notifyAutomation: async (notification) => {
          messages.push(notification.message);
        },
      },
    );
    expect(messages).toEqual([
      'Open Twitch Drops to refresh Twitch verification and resume your waiting campaigns.',
    ]);
  });
});
