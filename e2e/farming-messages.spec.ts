import { expect, test } from '@playwright/test';
import type { AppState } from '../src/types/index.ts';
import { createExtensionProfile, fixtureGame, openPopup, runningState, seedAppState } from './extension-fixture';

test('campaign messages expand, dismiss and stay hidden after popup and worker reopening', async () => {
  const profile = await createExtensionProfile();
  try {
    const id = 'campaign-failure:campaign:e2e-campaign:fixture';
    await seedAppState(profile, { ...runningState(false), isPaused: true,
      campaignFailureEpisodesByKey: { 'campaign:e2e-campaign': {
        id, game: fixtureGame, reason: 'stalled-progress', startedAt: Date.now(), lastAttemptAt: Date.now(), visible: true, exhausted: true,
      } }, dismissedFarmingMessageIds: [] });
    const bridge = await profile.context.newPage();
    await bridge.goto(`${profile.extensionUrl}/icons/icon.svg`);
    const recycle = async () => {
      const cdp = await profile.context.newCDPSession(bridge);
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      await cdp.detach();
      expect(await bridge.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CLAIM_LOG' }))).toMatchObject({ success: true });
    };
    await recycle();
    let popup = await openPopup(profile);
    await popup.setViewportSize({ width: 400, height: 850 });
    const messages = popup.getByRole('region', { name: 'Farming messages' });
    await expect(messages.getByText('Campaign warnings (1)')).toBeVisible();
    await expect(messages.getByRole('button', { name: 'Dismiss farming message' })).toBeHidden();
    await messages.getByText('Campaign warnings (1)').click();
    await expect(messages.getByText(/stays queued for retry/)).toBeVisible();
    await popup.screenshot({ path: '.output/farming-messages-popup.png', fullPage: true });
    await messages.getByRole('button', { name: 'Dismiss farming message' }).click();
    await expect(messages).toBeHidden();
    await expect.poll(() => popup.evaluate(async () => {
      const { appState } = await chrome.storage.local.get('appState');
      return (appState as AppState).dismissedFarmingMessageIds;
    })).toContain(id);
    await popup.close();
    await recycle();
    popup = await openPopup(profile);
    await expect(popup.getByRole('region', { name: 'Farming messages' })).toBeHidden();
    expect(await popup.evaluate(async () => {
      const { appState } = await chrome.storage.local.get('appState');
      const state = appState as AppState;
      return { isPaused: state.isPaused, authorized: state.manualQueueAuthorized,
        episode: state.campaignFailureEpisodesByKey['campaign:e2e-campaign']?.id };
    })).toEqual({ isPaused: true, authorized: true, episode: id });
    const monitor = await profile.context.newPage();
    await monitor.goto(`${profile.extensionUrl}/monitor.html`);
    await monitor.screenshot({ path: '.output/farming-messages-monitor.png', fullPage: true });
  } finally {
    await profile.close();
  }
});
