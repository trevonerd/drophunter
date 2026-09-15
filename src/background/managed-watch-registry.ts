import { browser } from '../shared/browser-api.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';

const PREFIX = 'managedWatchOwnershipV1:';
type ManagedOwnership = Extract<WatchOwnershipV1, { kind: 'managed-tab' }>;

export async function rememberManagedWatch(
  tabId: number,
  ownershipToken: string,
  expectedUrl: string,
): Promise<void> {
  const expectedChannel = new URL(expectedUrl).pathname.slice(1);
  const ownership: ManagedOwnership = { kind: 'managed-tab', tabId, ownershipToken, expectedChannel };
  await browser.storage.local.set({ [`${PREFIX}${ownershipToken}`]: ownership });
}

export async function forgetManagedWatch(ownershipToken: string): Promise<void> {
  await browser.storage.local.remove(`${PREFIX}${ownershipToken}`);
}

export async function forgetClosedManagedWatch(tabId: number): Promise<void> {
  const registered = await listManagedWatches();
  await Promise.all(
    registered.filter((item) => item.tabId === tabId).map((item) => forgetManagedWatch(item.ownershipToken)),
  );
}

export async function listManagedWatches(): Promise<readonly ManagedOwnership[]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored).flatMap(([key, value]): ManagedOwnership[] => {
    if (
      !key.startsWith(PREFIX) ||
      typeof value !== 'object' ||
      value === null ||
      !('kind' in value) ||
      value.kind !== 'managed-tab' ||
      !('tabId' in value) ||
      typeof value.tabId !== 'number' ||
      !Number.isInteger(value.tabId) ||
      value.tabId < 0 ||
      !('ownershipToken' in value) ||
      typeof value.ownershipToken !== 'string' ||
      key !== `${PREFIX}${value.ownershipToken}` ||
      !('expectedChannel' in value) ||
      typeof value.expectedChannel !== 'string' ||
      !/^[a-z0-9_]+$/i.test(value.expectedChannel)
    )
      return [];
    return [
      {
        kind: 'managed-tab',
        tabId: value.tabId,
        ownershipToken: value.ownershipToken,
        expectedChannel: value.expectedChannel,
      },
    ];
  });
}
