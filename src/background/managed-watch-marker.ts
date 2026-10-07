import { browser } from '../shared/browser-api.ts';
import { forgetManagedWatch, rememberManagedWatch } from './managed-watch-registry.ts';

const MANAGED_WATCH_MARKER_KEY = '__drophunter_managed_watch_v1';
let pendingMutation: Promise<unknown> = Promise.resolve();

export function serializeManagedWatchMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = pendingMutation.then(operation);
  pendingMutation = next.catch(() => undefined);
  return next;
}

export interface ManagedWatchMarker {
  forget?(ownershipToken: string): Promise<void>;
  write(
    tabId: number,
    ownershipToken: string,
    expectedUrl: string,
    isCurrent?: () => boolean,
  ): Promise<boolean>;
  locate(
    ownershipToken: string,
    expectedUrl: string,
    allowNavigation?: boolean,
  ): Promise<{
    readonly id: number;
    readonly url?: string;
    readonly windowId?: number;
  } | null>;
}

export type ManagedWatchMarkerInspection =
  | {
      readonly kind: 'found';
      readonly tab: { readonly id: number; readonly url: string; readonly windowId?: number };
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ambiguous' };

export async function inspectManagedWatchMarker(
  ownershipToken: string,
  expectedUrl: string,
  allowNavigation = false,
): Promise<ManagedWatchMarkerInspection> {
  try {
    const tabs = await browser.tabs.query({
      url: [allowNavigation ? 'https://www.twitch.tv/*' : expectedUrl],
    });
    const matched = [];
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || !tab.url || (!allowNavigation && tab.url !== expectedUrl)) continue;
      if (tab.status === 'loading') return { kind: 'unavailable' };
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: readManagedWatchMarkerInPage,
        args: [MANAGED_WATCH_MARKER_KEY, ownershipToken, expectedUrl, allowNavigation],
      });
      const main = results.find((result) => result.frameId === 0);
      if (typeof main?.result !== 'boolean') return { kind: 'unavailable' };
      if (main.result) matched.push({ id: tab.id, url: tab.url, windowId: tab.windowId });
    }
    if (matched.length > 1) return { kind: 'ambiguous' };
    const tab = matched[0];
    return tab ? { kind: 'found', tab } : { kind: 'missing' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export function writeManagedWatchMarkerInPage(
  key: string,
  ownershipToken: string,
  expectedUrl: string,
): boolean {
  if (globalThis.location.href !== expectedUrl) return false;
  globalThis.sessionStorage.setItem(key, JSON.stringify({ version: 1, ownershipToken, expectedUrl }));
  return true;
}

export function readManagedWatchMarkerInPage(
  key: string,
  ownershipToken: string,
  expectedUrl: string,
  allowNavigation = false,
): boolean {
  if (
    globalThis.location.href !== expectedUrl &&
    (!allowNavigation || new URL(globalThis.location.href).origin !== 'https://www.twitch.tv')
  )
    return false;
  try {
    const value: unknown = JSON.parse(globalThis.sessionStorage.getItem(key) ?? 'null');
    return (
      typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      value.version === 1 &&
      'ownershipToken' in value &&
      value.ownershipToken === ownershipToken &&
      'expectedUrl' in value &&
      value.expectedUrl === expectedUrl
    );
  } catch {
    return false;
  }
}

export const managedWatchMarker: ManagedWatchMarker = {
  forget: forgetManagedWatch,
  write(tabId, ownershipToken, expectedUrl, isCurrent = () => true) {
    return serializeManagedWatchMutation(async () => {
      if (!isCurrent()) return false;
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          func: writeManagedWatchMarkerInPage,
          args: [MANAGED_WATCH_MARKER_KEY, ownershipToken, expectedUrl],
        });
        if (!isCurrent() || !results.some((result) => result.frameId === 0 && result.result === true))
          return false;
        await rememberManagedWatch(tabId, ownershipToken, expectedUrl);
        return true;
      } catch {
        return false;
      }
    });
  },
  async locate(ownershipToken, expectedUrl, allowNavigation = false) {
    const result = await inspectManagedWatchMarker(ownershipToken, expectedUrl, allowNavigation);
    return result.kind === 'found' ? result.tab : null;
  },
};

export async function pauseManagedWatch(
  ownership: import('./farming-automation-contracts.ts').WatchOwnershipV1,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (ownership.kind !== 'managed-tab') return;
  await serializeManagedWatchMutation(() => {
    if (!isCurrent()) return Promise.resolve([]);
    return browser.scripting.executeScript({
      target: { tabId: ownership.tabId },
      func: (key: string, token: string, expectedUrl: string) => {
        if (globalThis.location.href !== expectedUrl) return false;
        try {
          const marker: unknown = JSON.parse(globalThis.sessionStorage.getItem(key) ?? 'null');
          if (
            !marker ||
            typeof marker !== 'object' ||
            !('version' in marker) ||
            marker.version !== 1 ||
            !('ownershipToken' in marker) ||
            marker.ownershipToken !== token ||
            !('expectedUrl' in marker) ||
            marker.expectedUrl !== expectedUrl
          )
            return false;
          if (document.documentElement) delete document.documentElement.dataset.drophunterKeepalive;
          const control = document.querySelector?.<HTMLButtonElement>(
            'button[data-a-target="player-play-pause-button"][data-a-player-state="playing"]',
          );
          if (control?.isConnected && !control.disabled) {
            try {
              control.click();
            } catch {
              /* Native pause below remains available if Twitch replaces the control. */
            }
          }
          document.querySelectorAll('video').forEach((video) => video.pause());
          return true;
        } catch {
          return false;
        }
      },
      args: [
        MANAGED_WATCH_MARKER_KEY,
        ownership.ownershipToken,
        `https://www.twitch.tv/${encodeURIComponent(ownership.expectedChannel.toLowerCase())}`,
      ],
    });
  }).catch(() => undefined);
}
