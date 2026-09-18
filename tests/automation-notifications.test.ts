import { describe, expect, test } from 'bun:test';
import {
  createNotificationController,
  getAutomationNotificationId,
} from '../src/background/notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';
import {
  createAutomationNotificationFakes,
  createAutomationPayload,
} from './support/automation-notification-fakes.ts';

describe('automation notifications', () => {
  test('supports the persisted unfarmable warning event', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
    });

    const result = await controller.notifyAutomation(createAutomationPayload('unfarmable'));

    expect(result.notificationId).toBe(
      getAutomationNotificationId('unfarmable', 'campaign-1', 'unfarmable:campaign-1:1'),
    );
  });

  test('creates a stable actionable browser notification for a campaign transition', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
    });

    const result = await controller.notifyAutomation(createAutomationPayload('start'));

    expect(result).toEqual({
      shown: true,
      deduplicated: false,
      notificationId: getAutomationNotificationId('start', 'campaign-1', 'start:campaign-1:1'),
    });
    expect(fakes.records).toEqual([
      {
        id: 'drophunter-automation-start-campaign-1-start%3Acampaign-1%3A1',
        options: {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'DropHunter started Cyberpunk 2077',
          message: 'Phantom Liberty Rewards · Next reward in 30m · Ends in 8h',
          priority: 2,
          buttons: [{ title: 'Open DropHunter' }, { title: 'Pause' }],
        },
      },
    ]);
  });

  test('leaves transition deduplication to the shared event notifier', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
    });
    const payload = createAutomationPayload('discovery');

    const first = await controller.notifyAutomation(payload);
    const second = await controller.notifyAutomation(payload);

    expect(first).toEqual({
      shown: true,
      deduplicated: false,
      notificationId: getAutomationNotificationId('discovery', 'campaign-1', 'discovery:campaign-1:1'),
    });
    expect(second).toEqual(first);
    expect(fakes.records).toHaveLength(2);
  });

  test('routes notification clicks and actions to injected hooks', async () => {
    const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
    const fakes = createAutomationNotificationFakes(true);
    const actions: string[] = [];
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {},
      openDropHunter: async () => {
        actions.push('open');
      },
      pauseFarming: async () => {
        actions.push('pause');
      },
    });
    const payload = createAutomationPayload('preemption', 'campaign-2');
    const notificationId = getAutomationNotificationId(
      payload.event,
      payload.campaignId,
      payload.transitionId,
    );

    await controller.notifyAutomation(payload);
    fakes.clickedListeners[0]?.(notificationId);
    fakes.buttonClickedListeners[0]?.(notificationId, 0);
    fakes.buttonClickedListeners[0]?.(notificationId, 1);
    fakes.buttonClickedListeners[0]?.(notificationId, 2);
    await Promise.resolve();

    expect(actions).toEqual(['open', 'open', 'pause']);
  });
});
