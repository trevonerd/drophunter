import { browser } from '../shared/browser-api.ts';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';

/** Run in Twitch's world so its router receives the same event as browser Back. */
export function navigateTwitchChannelInPage(expectedUrl: string, previousUrl: string): boolean {
  if (location.href !== previousUrl) return false;
  const target = new URL(expectedUrl);
  if (target.origin !== location.origin || target.hostname !== 'www.twitch.tv') return false;
  if (location.href === expectedUrl) return true;
  sessionStorage.setItem('__drophunter_route_target_v1', expectedUrl);
  history.pushState(history.state, '', expectedUrl);
  dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  return location.href === expectedUrl;
}

export async function updateManagedWatchTab(
  tabId: number,
  properties: chrome.tabs.UpdateProperties,
  isCurrent: () => boolean | Promise<boolean>,
): Promise<void> {
  if (!(await isCurrent())) return;
  const tab = properties.url ? await browser.tabs.get(tabId) : null;
  if (!(await isCurrent())) return;
  const target = properties.url;
  if (
    target &&
    tab?.url &&
    !tab.pendingUrl &&
    getFarmableTwitchChannelNameFromUrl(target) &&
    new URL(target).origin === 'https://www.twitch.tv' &&
    new URL(tab.url).origin === 'https://www.twitch.tv'
  ) {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: navigateTwitchChannelInPage,
      args: [target, tab.url],
    });
    if (!results.some((result) => result.frameId === 0 && result.result === true))
      throw new Error('Managed Twitch navigation unavailable');
    if (!(await isCurrent())) return;
    const { url: _url, ...settings } = properties;
    if (Object.keys(settings).length) await browser.tabs.update(tabId, settings);
    return;
  }
  if (tab?.pendingUrl) throw new Error('Managed tab navigation still pending');
  await browser.tabs.update(tabId, properties);
}
