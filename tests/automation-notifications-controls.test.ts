import { describe, expect, test } from 'bun:test';
import {
  createNotificationController,
  getAutomationNotificationId,
} from '../src/background/notifications.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';
import { createInitialState } from '../src/shared/utils.ts';
import {
  createAutomationNotificationFakes,
  createAutomationPayload,
} from './support/automation-notification-fakes.ts';

describe('automation notification controls', () => {
  test('the Pause action preserves enabled favorite automation and snoozes only when it is disabled', async () => {
    for (const automaticFavoritesEnabled of [true, false]) {
      const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
      const fakes = createAutomationNotificationFakes(true);
      const actions: string[] = [];
      const userActions = createFarmingAutomationUserActionHandlers(
        {
          request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
          snooze: async (reason) => {
            actions.push(`snooze:${reason}`);
            return 'snoozed';
          },
        },
        {
          automaticFavoritesEnabled: () => automaticFavoritesEnabled,
          handlePauseFarming: async () => {
            actions.push('pause');
            return { success: true };
          },
          handleResumeFarming: async () => ({ success: true }),
          handleStopFarming: async () => ({ success: true }),
        },
      );
      const controller = createNotificationController(state, {
        permissionsApi: fakes.permissionsApi,
        notificationsApi: fakes.notificationsApi,
        saveState: async () => {},
        pauseFarming: userActions.pauseFarming,
      });
      const payload = createAutomationPayload('start', `campaign-${automaticFavoritesEnabled}`);
      const notificationId = getAutomationNotificationId(
        payload.event,
        payload.campaignId,
        payload.transitionId,
      );

      await controller.notifyAutomation(payload);
      fakes.buttonClickedListeners[0]?.(notificationId, 1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(actions).toEqual(automaticFavoritesEnabled ? ['pause'] : ['snooze:manual-pause', 'pause']);
    }
  });

  test('preserves auto-start when automation notification permission is revoked', async () => {
    const state = {
      appState: {
        ...createInitialState(),
        notificationsEnabled: true,
        autoStartFavoriteGames: true,
      },
    };
    const fakes = createAutomationNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    const result = await controller.notifyAutomation(createAutomationPayload('preemption'));

    expect(result).toEqual({ shown: false, deduplicated: false });
    expect(state.appState.notificationsEnabled).toBe(false);
    expect(state.appState.autoStartFavoriteGames).toBe(true);
    expect(saveCount).toBe(1);
    expect(fakes.records).toEqual([]);
  });

  test('preserves auto-start when a revoked permission is detected during a state sync', async () => {
    const state = {
      appState: {
        ...createInitialState(),
        notificationsEnabled: false,
        autoStartFavoriteGames: true,
      },
    };
    const fakes = createAutomationNotificationFakes(false);
    let saveCount = 0;
    const controller = createNotificationController(state, {
      permissionsApi: fakes.permissionsApi,
      notificationsApi: fakes.notificationsApi,
      saveState: async () => {
        saveCount += 1;
      },
    });

    await controller.syncPermissionState();

    expect(state.appState.autoStartFavoriteGames).toBe(true);
    expect(saveCount).toBe(0);
  });
});
