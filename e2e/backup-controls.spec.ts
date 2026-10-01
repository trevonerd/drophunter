import { expect, test } from '@playwright/test';
import { createExtensionProfile, openPopup, seedAppState } from './extension-fixture';

const backupFile = {
  format: 'drophunter-backup',
  formatVersion: 1,
  extensionVersion: '4.0.0',
  exportedAt: '2026-09-30T12:00:00.000Z',
  sections: {
    settings: { version: 1, data: { notificationsEnabled: true, autoStartFavoriteGames: true } },
    favorites: { version: 1, data: [{ gameId: 'backup-game', lastKnownName: 'Backup Game', addedAt: 10 }] },
    hidden: { version: 1, data: [] },
    statistics: { version: 1, data: { totalDropsClaimed: 4, totalChannelPointsClaimed: 900 } },
    history: { version: 1, data: [] },
  },
};
const partialBackup = {
  ...backupFile,
  sections: { ...backupFile.sections, future: { version: 1, data: {} } },
};

async function openBackupSettings(profile: Awaited<ReturnType<typeof createExtensionProfile>>) {
  const popup = await openPopup(profile);
  await popup.getByRole('button', { name: 'Open settings' }).click();
  const main = popup.locator('main.dh-view');
  const backup = main.getByRole('heading', { name: 'Backup and restore' });
  const about = main.getByRole('heading', { name: 'About DropHunter' });
  const sectionOrder = await popup.evaluate(() => {
    const root = document.querySelector('main.dh-view');
    if (!root) return [];
    return [...root.children].map((node) => {
      if (node.querySelector('summary')?.textContent?.includes('Advanced settings')) return 'advanced';
      if (node.querySelector('#settings-backup-heading')) return 'backup';
      if (node.querySelector('#settings-about-heading')) return 'about';
      return '';
    });
  });
  expect(sectionOrder.indexOf('advanced')).toBeLessThan(sectionOrder.indexOf('backup'));
  expect(sectionOrder.indexOf('backup')).toBeLessThan(sectionOrder.indexOf('about'));
  await backup.scrollIntoViewIfNeeded();
  return popup;
}

test('settings export a backup and preview then merge selected data', async () => {
  const profile = await createExtensionProfile();
  await seedAppState(profile, {
    favoriteGames: [{ gameId: 'local-game', lastKnownName: 'Local Game', addedAt: 1 }],
    totalDropsClaimed: 2,
    totalChannelPointsClaimed: 100,
    notificationsEnabled: false,
    autoStartFavoriteGames: false,
  });
  await profile.shutdown();
  const seededProfile = await createExtensionProfile(profile.userDataDir);
  try {
    const popup = await openBackupSettings(seededProfile);
    await popup.screenshot({ path: '.output/backup-idle-panel.png', fullPage: true });

    const downloadPromise = popup.waitForEvent('download');
    await popup.getByRole('button', { name: 'Export backup' }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^drophunter-backup-.*\.json$/);

    const fileInput = popup.getByLabel('Choose a DropHunter backup file');
    await fileInput.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupFile)) });
    await expect(popup.getByRole('heading', { name: 'Backup preview' })).toBeVisible();
    await popup.screenshot({ path: '.output/backup-preview.png', fullPage: true });
    await expect(popup.getByText('Merge adds the backup’s channel points total')).toBeVisible();
    await popup.getByLabel('Restore settings from backup').check();
    await expect(popup.getByText('Notification permission and favorite auto-start may need to be enabled again after restore.')).toBeVisible();
    await popup.getByRole('button', { name: 'Restore selected data' }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible();

    const saved = await popup.evaluate(async () => chrome.storage.local.get('appState'));
    expect(saved.appState).toMatchObject({
      favoriteGames: expect.arrayContaining([{ gameId: 'backup-game', lastKnownName: 'Backup Game', addedAt: 10 }]),
      totalChannelPointsClaimed: 1000,
      notificationsEnabled: false,
      autoStartFavoriteGames: false,
    });
  } finally {
    await seededProfile.shutdown();
    await profile.close();
  }
});

test('replace mode requires acknowledgement for a partial backup and cancellation stays visible', async () => {
  const profile = await createExtensionProfile();
  try {
    const popup = await openBackupSettings(profile);
    const importButton = popup.getByRole('button', { name: 'Import backup' });
    await importButton.focus();
    await popup.getByLabel('Choose a DropHunter backup file').evaluate((input) => input.dispatchEvent(new Event('cancel')));
    await expect(popup.getByRole('status').filter({ hasText: 'No backup selected' })).toBeVisible();
    await expect(importButton).toBeFocused();

    const fileInput = popup.getByLabel('Choose a DropHunter backup file');
    await fileInput.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await expect(popup.getByRole('status').filter({ hasText: 'This file is not valid JSON.' })).toBeVisible();
    await fileInput.setInputFiles({ name: 'unsupported.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(popup.getByRole('status').filter({ hasText: 'This backup format cannot be imported' })).toBeVisible();

    await fileInput.setInputFiles({
      name: 'partial.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(partialBackup)),
    });
    await expect(popup.getByText('Unknown section; excluded from import.')).toBeVisible();
    await popup.getByRole('button', { name: 'Cancel restore' }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'Restore canceled. No changes were made.' })).toBeVisible();
    await expect(importButton).toBeFocused();

    await fileInput.setInputFiles({
      name: 'partial.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(partialBackup)),
    });
    await expect(popup.getByText('Unknown section; excluded from import.')).toBeVisible();
    await popup.getByLabel('Replace selected sections').check();
    const restore = popup.getByRole('button', { name: 'Restore selected data' });
    await expect(restore).toBeDisabled();
    const acknowledgement = popup.getByLabel(/I understand that this restore is partial/);
    await acknowledgement.check();
    await expect(restore).toBeEnabled();

    await popup.getByRole('button', { name: 'Refresh preview' }).click();
    await expect(restore).toBeDisabled();
    await acknowledgement.check();
    await expect(restore).toBeEnabled();
    await popup.getByRole('button', { name: 'Cancel restore' }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'Restore canceled. No changes were made.' })).toBeVisible();
  } finally {
    await profile.close();
  }
});
