import { expect, test, type Worker } from '@playwright/test';
import { createExtensionProfile, getExtensionWorker, openPopup } from './extension-fixture';
import {
  getPermissionCalls,
  grantPendingPermission,
  installPermissionTestDouble,
  setPermissionRequest,
} from './permission-test-double';

async function expectAppState(worker: Worker, key: string, value: boolean) {
  await expect
    .poll(async () =>
      worker.evaluate(async (stateKey) => {
        const { appState = {} } = await chrome.storage.local.get('appState');
        return (appState as Record<string, unknown>)[stateKey];
      }, key),
    )
    .toBe(value);
}

test('notification permission completion survives closing the popup while the request is pending', async () => {
  const profile = await createExtensionProfile();
  try {
    const worker = await getExtensionWorker(profile.context);
    await installPermissionTestDouble(worker);
    await setPermissionRequest(worker, { pending: true });

    const popup = await openPopup(profile);
    await popup.getByRole('button', { name: 'Open settings' }).click();
    const notifications = popup.getByRole('switch', { name: 'Notifications' });
    await notifications.click();
    await expect.poll(async () => (await getPermissionCalls(worker)).length).toBe(1);
    await popup.close();

    await grantPendingPermission(worker);
    await expectAppState(worker, 'notificationsEnabled', true);
    await setPermissionRequest(worker, { pending: false });

    const reopened = await openPopup(profile);
    await reopened.getByRole('button', { name: 'Open settings' }).click();
    const reopenedNotifications = reopened.getByRole('switch', { name: 'Notifications' });
    await expect(reopenedNotifications).toBeChecked();
    await reopenedNotifications.click();
    await expect(reopenedNotifications).not.toBeChecked();
    await expectAppState(worker, 'notificationsEnabled', false);
    expect(await getPermissionCalls(worker)).toEqual([{ permissions: ['notifications'] }]);
  } finally {
    await profile.close();
  }
});

test('Telegram permission completion survives closing the popup and credentials remain usable', async () => {
  const profile = await createExtensionProfile();
  try {
    const worker = await getExtensionWorker(profile.context);
    await installPermissionTestDouble(worker);
    await setPermissionRequest(worker, { pending: true });

    const popup = await openPopup(profile);
    await popup.getByRole('button', { name: 'Open settings' }).click();
    await popup.getByText('Advanced settings', { exact: true }).click();
    await popup.locator('summary').filter({ hasText: 'Telegram alerts' }).click();
    await popup.getByRole('switch', { name: 'Telegram alerts' }).click();
    await expect.poll(async () => (await getPermissionCalls(worker)).length).toBe(1);
    await popup.close();

    await grantPendingPermission(worker);
    await expectAppState(worker, 'telegramAlertsEnabled', true);
    await setPermissionRequest(worker, { pending: false });

    const reopened = await openPopup(profile);
    await reopened.getByRole('button', { name: 'Open settings' }).click();
    await reopened.getByText('Advanced settings', { exact: true }).click();
    await reopened.locator('summary').filter({ hasText: 'Telegram alerts' }).click();
    await expect(reopened.getByRole('switch', { name: 'Telegram alerts' })).toBeChecked();
    await expect(reopened.getByLabel('Bot token')).toBeVisible();

    const telegramCalls: string[] = [];
    await profile.context.route('https://api.telegram.org/**', async (route) => {
      telegramCalls.push(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
      await route.fulfill({ json: { ok: true, result: { id: 123456, is_bot: true } } });
    });
    const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
    await reopened.getByLabel('Bot token').fill(token);
    await reopened.getByLabel('Chat ID').fill('123456789');
    await setPermissionRequest(worker, { allow: true, pending: true });
    await reopened.getByRole('button', { name: 'Save credentials' }).click();
    await expect.poll(async () => (await getPermissionCalls(worker)).length).toBe(2);
    await reopened.close();
    await grantPendingPermission(worker);
    await setPermissionRequest(worker, { pending: false });
    await expect.poll(async () => telegramCalls.length).toBe(1);

    const afterSave = await openPopup(profile);
    await afterSave.getByRole('button', { name: 'Open settings' }).click();
    await afterSave.getByText('Advanced settings', { exact: true }).click();
    await afterSave.locator('summary').filter({ hasText: 'Telegram alerts' }).click();
    await expect(afterSave.getByLabel('Bot token')).toHaveAttribute('placeholder', 'Saved token (enter to replace)');
    await expect(afterSave.getByLabel('Chat ID')).toHaveValue('123456789');
    await expect(afterSave.getByRole('button', { name: 'Send test message' })).toBeEnabled();
    await setPermissionRequest(worker, { allow: true, pending: true });
    await afterSave.getByRole('button', { name: 'Send test message' }).click();
    await expect.poll(async () => (await getPermissionCalls(worker)).length).toBe(3);
    await afterSave.close();
    await grantPendingPermission(worker);
    await setPermissionRequest(worker, { pending: false });
    await expect.poll(async () => telegramCalls.length).toBe(2);
    expect(telegramCalls).toEqual(['getMe', 'sendMessage']);
  } finally {
    await profile.close();
  }
});
