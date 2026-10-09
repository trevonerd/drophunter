import { expect, test } from '@playwright/test';
import { createExtensionProfile, openPopup } from './extension-fixture';

test('Twitch adblock hooks the page and worker, preserves integrity and applies toggles after reload', async () => {
  const profile = await createExtensionProfile();
  try {
    await profile.context.setOffline(false);
    await profile.context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') {
        await route.continue();
      } else if (url.hostname === 'gql.twitch.tv' && url.pathname === '/integrity') {
        await route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ token: 'fixture-integrity-token', expiration: 2_000_000_000 }),
        });
      } else if (url.hostname === 'www.twitch.tv' && url.pathname === '/fixture-player-worker.js') {
        await route.fulfill({
          contentType: 'application/javascript',
          body: `self.postMessage({ fixture: true, blocking: self.__TTVAB_STATE__?.IsAdStrippingEnabled === true });
            const cycleStartedAt = Date.now();
            self.onmessage = event => {
              if (!event.data.fixtureAds) return;
              self.postMessage({ __ttvabWorkerBridge: true, message: {
                key: 'AdPodProgress', channel: 'adblockfixture', mediaKey: 'live:adblockfixture',
                adIds: event.data.fixtureAds, cycleStartedAt,
                expectedPodLength: 3, maxAdPodPosition: 3, observedZeroAdPodPosition: false
              } });
            };`,
        });
      } else if (url.hostname === 'www.twitch.tv' && url.pathname === '/adblockfixture') {
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>Twitch fixture</title><script>
            window.workerResult = new Promise((resolve, reject) => {
              const worker = new Worker('/fixture-player-worker.js');
              window.fixtureWorker = worker;
              worker.onmessage = event => { if (event.data.fixture) resolve(event.data); };
              worker.onerror = reject;
            });
            fetch('https://gql.twitch.tv/integrity');
          </script>`,
        });
      } else {
        await route.abort();
      }
    });
    const page = await profile.context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const bridge = await profile.context.newPage();
    await bridge.goto(`${profile.extensionUrl}/icons/icon.svg`);
    const result = () => page.evaluate('window.workerResult');
    const hasEngine = () => page.evaluate('typeof window.ttvabVersion === "number"');
    await page.goto('https://www.twitch.tv/adblockfixture');
    await expect.poll(result).toEqual({ fixture: true, blocking: true });
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('__drophunter_integrity__') ?? '{}').token)).toBe('fixture-integrity-token');
    expect(await hasEngine()).toBe(true);

    const total = () => bridge.evaluate(async () => {
      const { appState } = await chrome.storage.local.get('appState');
      return appState && typeof appState === 'object' && 'totalTwitchAdsBlocked' in appState
        ? appState.totalTwitchAdsBlocked
        : undefined;
    });
    const reportAds = (adIds: string[]) => page.evaluate(
      (ids) => (window as unknown as { fixtureWorker: Worker }).fixtureWorker.postMessage({ fixtureAds: ids }),
      adIds,
    );
    await reportAds(['ad-1', 'ad-2']);
    await expect.poll(total).toBe(2);
    await reportAds(['ad-2', 'ad-3']);
    await expect.poll(total).toBe(3);
    const popup = await openPopup(profile);
    await expect(popup.getByText('Ads blocked', { exact: true })).toHaveCount(0);
    await popup.getByRole('button', { name: 'Open settings' }).click();
    await popup.getByText('Advanced settings', { exact: true }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'Ads blocked' })).toHaveText('Ads blocked 3');

    const cdp = await profile.context.newCDPSession(bridge);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();

    expect(await bridge.evaluate(() => chrome.runtime.sendMessage({
      type: 'SET_TWITCH_ADBLOCK_ENABLED', payload: { enabled: false },
    }))).toMatchObject({ success: true, twitchAdblockEnabled: false });
    expect(await hasEngine()).toBe(true);
    await page.reload();
    await expect.poll(result).toEqual({ fixture: true, blocking: false });
    expect(await hasEngine()).toBe(false);
    await reportAds(['ad-4']);
    expect(await total()).toBe(3);

    expect(await bridge.evaluate(() => chrome.runtime.sendMessage({
      type: 'SET_TWITCH_ADBLOCK_ENABLED', payload: { enabled: true },
    }))).toMatchObject({ success: true, twitchAdblockEnabled: true });
    await page.reload();
    await expect.poll(result).toEqual({ fixture: true, blocking: true });
    await reportAds(['ad-4']);
    await expect.poll(total).toBe(4);
    await expect(popup.getByRole('status').filter({ hasText: 'Ads blocked' })).toHaveText('Ads blocked 4');
    expect(pageErrors).toEqual([]);
  } finally {
    await profile.close();
  }
});
