import { browser } from '../shared/browser-api.ts';
import { forgetManagedWatch, rememberManagedWatch } from './managed-watch-registry.ts';

const MANAGED_WATCH_MARKER_KEY = '__drophunter_managed_watch_v1';

export interface ManagedWatchMarker {
  forget?(ownershipToken: string): Promise<void>;
  write(tabId: number, ownershipToken: string, expectedUrl: string): Promise<boolean>;
  locate(
    ownershipToken: string,
    expectedUrl: string,
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
): Promise<ManagedWatchMarkerInspection> {
  try {
    const tabs = await browser.tabs.query({ url: [expectedUrl] });
    const matched = [];
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || tab.url !== expectedUrl) continue;
      if (tab.status === 'loading') return { kind: 'unavailable' };
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: readManagedWatchMarkerInPage,
        args: [MANAGED_WATCH_MARKER_KEY, ownershipToken, expectedUrl],
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
): boolean {
  if (globalThis.location.href !== expectedUrl) return false;
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
  async write(tabId, ownershipToken, expectedUrl) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: writeManagedWatchMarkerInPage,
        args: [MANAGED_WATCH_MARKER_KEY, ownershipToken, expectedUrl],
      });
      if (!results.some((result) => result.frameId === 0 && result.result === true)) return false;
      await rememberManagedWatch(tabId, ownershipToken, expectedUrl);
      return true;
    } catch {
      return false;
    }
  },
  async locate(ownershipToken, expectedUrl) {
    const result = await inspectManagedWatchMarker(ownershipToken, expectedUrl);
    return result.kind === 'found' ? result.tab : null;
  },
};
