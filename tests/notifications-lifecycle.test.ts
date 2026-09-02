import { expect, test } from 'bun:test';
import { createNotificationController, type NotificationApi } from '../src/background/notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('enables notifications when the optional API appears after controller creation', async () => {
  const originalBrowser = Reflect.get(globalThis, 'browser');
  const records: Array<{ readonly id: string }> = [];
  const clickedListeners: Array<(notificationId: string) => void> = [];
  const buttonClickedListeners: Array<(notificationId: string, buttonIndex: number) => void> = [];
  const availableApi: NotificationApi = {
    async create(notificationIdOrOptions) {
      const id = typeof notificationIdOrOptions === 'string' ? notificationIdOrOptions : 'generated-id';
      records.push({ id });
      return id;
    },
    onClicked: {
      addListener(listener) {
        clickedListeners.push(listener);
      },
    },
    onButtonClicked: {
      addListener(listener) {
        buttonClickedListeners.push(listener);
      },
    },
  };
  let permissionGranted = false;
  let notificationsApi: NotificationApi | undefined;
  const runtimeBrowser = {
    permissions: {
      async contains() {
        return permissionGranted;
      },
    },
    get notifications() {
      return notificationsApi;
    },
  };
  Reflect.set(globalThis, 'browser', runtimeBrowser);

  try {
    const state = { appState: { ...createInitialState(), notificationsEnabled: false } };
    const controller = createNotificationController(state, {
      saveState: async () => {},
      openDropHunter: async () => {},
      pauseFarming: async () => {},
    });

    permissionGranted = true;
    notificationsApi = availableApi;
    const enabled = await controller.setNotificationsEnabled(true);
    await controller.notifyAutomation({
      event: 'start',
      campaignId: 'campaign-1',
      title: 'Campaign started',
      message: 'Farming is active.',
    });
    await controller.notifyAutomation({
      event: 'preemption',
      campaignId: 'campaign-2',
      title: 'Campaign changed',
      message: 'Farming moved to the next favorite.',
    });

    expect(enabled).toEqual({ success: true, notificationsEnabled: true });
    expect(state.appState.notificationsEnabled).toBe(true);
    expect(records).toHaveLength(2);
    expect(clickedListeners).toHaveLength(1);
    expect(buttonClickedListeners).toHaveLength(1);
  } finally {
    if (originalBrowser === undefined) Reflect.deleteProperty(globalThis, 'browser');
    else Reflect.set(globalThis, 'browser', originalBrowser);
  }
});
