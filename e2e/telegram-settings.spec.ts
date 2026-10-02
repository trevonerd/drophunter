import { expect, test } from '@playwright/test';
import { createExtensionProfile, getExtensionWorker } from './extension-fixture';
import { getPermissionCalls, installPermissionTestDouble, setPermissionRequest } from './permission-test-double';

test('Telegram settings request permission on enable and hide credentials when disabled', async () => {
  const profile = await createExtensionProfile();
  try {
    const worker = await getExtensionWorker(profile.context);
    await installPermissionTestDouble(worker);

    const popup = await profile.context.newPage();
    await popup.goto(`${profile.extensionUrl}/popup.html`);
    await popup.getByRole('button', { name: 'Open settings' }).click();
    await popup.getByText('Advanced settings', { exact: true }).click();
    await popup.locator('summary').filter({ hasText: 'Telegram alerts' }).click();

    const alertsSwitch = popup.getByRole('switch', { name: 'Telegram alerts' });
    await expect(alertsSwitch).not.toBeChecked();
    await expect(popup.getByLabel('Bot token')).toBeHidden();
    await expect(popup.getByRole('switch', { name: 'Telegram system notifications' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Save credentials' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Send test message' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Show setup guide' })).toBeHidden();

    await setPermissionRequest(worker, { allow: false });
    await alertsSwitch.click();
    await expect(alertsSwitch).not.toBeChecked();
    await expect(popup.getByRole('status')).toHaveText('Telegram host permission was not granted');

    await setPermissionRequest(worker, { allow: true });
    await alertsSwitch.click();
    await expect(alertsSwitch).toBeChecked();
    expect(await getPermissionCalls(worker)).toEqual([
      { origins: ['https://api.telegram.org/*'] },
      { origins: ['https://api.telegram.org/*'] },
    ]);

    await expect(popup.getByLabel('Bot token')).toBeVisible();
    await popup.getByLabel('Bot token').fill('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi');
    await popup.getByLabel('Chat ID').fill('123456789');
    const telegramCalls: Array<{ method: string; body: Record<string, unknown> }> = [];
    await profile.context.route('https://api.telegram.org/**', async (route) => {
      telegramCalls.push({
        method: new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({ json: { ok: true, result: { id: 123456, is_bot: true } } });
    });

    await popup.getByRole('button', { name: 'Save credentials' }).click();
    await expect(popup.getByRole('status')).toHaveText('Telegram credentials saved.');
    await popup.getByRole('button', { name: 'Send test message' }).click();
    await expect(popup.getByRole('status')).toHaveText('Telegram settings updated.');
    expect(telegramCalls).toEqual([
      { method: 'getMe', body: {} },
      {
        method: 'sendMessage',
        body: expect.objectContaining({
          chat_id: '123456789',
          text: 'DropHunter test — Telegram alerts are working.',
        }),
      },
    ]);
    expect(await getPermissionCalls(worker)).toEqual(
      Array.from({ length: 4 }, () => ({ origins: ['https://api.telegram.org/*'] })),
    );

    await alertsSwitch.click();
    await expect(alertsSwitch).not.toBeChecked();
    await expect(popup.getByLabel('Bot token')).toBeHidden();
    await expect(popup.getByLabel('Chat ID')).toBeHidden();
    await expect(popup.getByRole('switch', { name: 'Telegram system notifications' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Save credentials' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Send test message' })).toBeHidden();
    await expect(popup.getByRole('button', { name: 'Show setup guide' })).toBeHidden();

    await worker.evaluate(() => chrome.storage.local.remove('telegramE2ePermissionGranted'));
    await alertsSwitch.click();
    await expect(alertsSwitch).toBeChecked();
    await expect(popup.getByLabel('Chat ID')).toHaveValue('123456789');
    await expect(popup.getByRole('button', { name: 'Send test message' })).toBeEnabled();
    await alertsSwitch.click();
    await expect(alertsSwitch).not.toBeChecked();
    await expect(popup.getByLabel('Bot token')).toBeHidden();
  } finally {
    await profile.close();
  }
});
