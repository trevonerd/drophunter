import { expect, test } from '@playwright/test';
import { createExtensionProfile, getExtensionWorker } from './extension-fixture';

test('Telegram settings request permission on enable and hide credentials when disabled', async () => {
  const profile = await createExtensionProfile();
  try {
    const worker = await getExtensionWorker(profile.context);
    await worker.evaluate(() => {
      const originalContains = chrome.permissions.contains.bind(chrome.permissions);
      Object.defineProperty(chrome.permissions, 'contains', {
        configurable: true,
        value: async (permission: chrome.permissions.Permissions) => {
          const { telegramE2ePermissionGranted } = await chrome.storage.local.get(
            'telegramE2ePermissionGranted',
          );
          return telegramE2ePermissionGranted === true ? true : originalContains(permission);
        },
      });
    });

    const popup = await profile.context.newPage();
    await popup.addInitScript(() => {
      type PermissionCall = { origins?: string[]; userGesture: boolean };
      type TestWindow = Window & {
        telegramE2eAllowPermission?: boolean;
        telegramE2ePermissionCalls?: PermissionCall[];
      };
      const testWindow = window as TestWindow;
      testWindow.telegramE2eAllowPermission = true;
      testWindow.telegramE2ePermissionCalls = [];
      Object.defineProperty(chrome.permissions, 'request', {
        configurable: true,
        value: async (permission: chrome.permissions.Permissions) => {
          const calls = testWindow.telegramE2ePermissionCalls;
          if (!calls) throw new Error('Missing test permission call log');
          calls.push({ origins: permission.origins, userGesture: navigator.userActivation.isActive });
          if (!testWindow.telegramE2eAllowPermission) return false;
          await chrome.storage.local.set({ telegramE2ePermissionGranted: true });
          return true;
        },
      });
    });
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

    await popup.evaluate(() => {
      (window as Window & { telegramE2eAllowPermission?: boolean }).telegramE2eAllowPermission = false;
    });
    await alertsSwitch.click();
    await expect(alertsSwitch).not.toBeChecked();
    await expect(popup.getByRole('status')).toHaveText('Telegram host permission was not granted');

    await popup.evaluate(() => {
      (window as Window & { telegramE2eAllowPermission?: boolean }).telegramE2eAllowPermission = true;
    });
    await alertsSwitch.click();
    await expect(alertsSwitch).toBeChecked();
    expect(await popup.evaluate(() =>
      (window as Window & { telegramE2ePermissionCalls?: Array<{ origins?: string[]; userGesture: boolean }> })
        .telegramE2ePermissionCalls ?? [],
    )).toEqual([
      { origins: ['https://api.telegram.org/*'], userGesture: true },
      { origins: ['https://api.telegram.org/*'], userGesture: true },
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
    expect(await popup.evaluate(() =>
      (window as Window & { telegramE2ePermissionCalls?: Array<{ origins?: string[]; userGesture: boolean }> })
        .telegramE2ePermissionCalls ?? [],
    )).toEqual(
      Array.from({ length: 4 }, () => ({ origins: ['https://api.telegram.org/*'], userGesture: true })),
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
