import { expect, test } from '@playwright/test';
import { createExtensionProfile, getExtensionWorker, openPopup, runningState, seedAppState } from './extension-fixture';

test('Open Twitch Drops brings an existing Drops window in front of the popup window', async () => {
  const profile = await createExtensionProfile();
  try {
    const popup = await openPopup(profile);
    const targetWindowId = await popup.evaluate(async () => {
      const current = await chrome.windows.getCurrent();
      const target = await chrome.windows.create({ url: 'https://www.twitch.tv/drops/inventory', focused: false });
      if (current.id === undefined || target?.id === undefined) throw new Error('Missing browser window');
      await chrome.windows.update(current.id, { focused: true });
      return target.id;
    });
    await expect.poll(() => popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/drops/inventory*' });
      return tabs.length;
    })).toBe(1);
    await popup.getByRole('button', { name: 'Open Twitch Drops', exact: true }).click();
    await expect.poll(() => popup.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(targetWindowId);
    expect(await popup.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.twitch.tv/drops/inventory*' })).length)).toBe(1);
  } finally {
    await profile.close();
  }
});

test('popup does not offer Retry during a restored network cooldown', async () => {
  const profile = await createExtensionProfile();
  try {
    const deadline = Date.now() + 8 * 60_000;
    await seedAppState(profile, { ...runningState(false), recoveryReason: 'twitch-network', recoveryBackoffUntil: deadline });
    const worker = await getExtensionWorker(profile.context);
    await worker.evaluate(async (apiBackoffUntil) => {
      const { timingState = {} } = await chrome.storage.local.get('timingState');
      const previous = timingState && typeof timingState === 'object' ? timingState : {};
      await chrome.storage.local.set({ timingState: { ...previous, apiBackoffUntil } });
    }, deadline);
    const bridge = await profile.context.newPage();
    await bridge.goto(`${profile.extensionUrl}/icons/icon.svg`);
    const cdp = await profile.context.newCDPSession(bridge);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    await bridge.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
    const popup = await openPopup(profile);
    await expect(popup.getByText(/Twitch request failed; checking connection/)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Retry now', exact: true })).toHaveCount(0);
    expect(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'RETRY_FARMING' }))).toMatchObject({
      success: false,
      error: 'Twitch rate limit or network cooldown is still active. Retry after the displayed deadline.',
    });
    await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  } finally {
    await profile.close();
  }
});
