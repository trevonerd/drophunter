import { browser } from '../shared/browser-api.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';

const PREFIX = 'managedWatchOwnershipV1:';
type ManagedOwnership = Extract<WatchOwnershipV1, { kind: 'managed-tab' }>;

export async function rememberManagedWatch(
  tabId: number,
  ownershipToken: string,
  expectedUrl: string,
  options: { readonly provisional?: true; readonly replacesOwnershipToken?: string } = {},
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const expectedChannel = new URL(expectedUrl).pathname.slice(1);
  const ownership: ManagedOwnership = { kind: 'managed-tab', tabId, ownershipToken, expectedChannel };
  await browser.storage.local.set({
    [`${PREFIX}${ownershipToken}`]: {
      ...ownership,
      ...(options.provisional ? { provisional: true } : {}),
      ...(options.replacesOwnershipToken ? { replacesOwnershipToken: options.replacesOwnershipToken } : {}),
    },
  });
  if (!isCurrent()) return;
  const registered = await listManagedWatches();
  if (!isCurrent()) return;
  await Promise.all(
    registered
      .filter((item) => item.tabId === tabId && item.ownershipToken !== ownershipToken)
      .map((item) => forgetManagedWatch(item.ownershipToken)),
  );
}

export async function isProvisionalManagedWatch(ownership: ManagedOwnership): Promise<boolean> {
  return (await getManagedWatchPreparation(ownership)) !== null;
}

export async function getManagedWatchPreparation(ownership: ManagedOwnership): Promise<{
  readonly provisional: true;
  readonly replacesOwnershipToken?: string;
} | null> {
  const key = `${PREFIX}${ownership.ownershipToken}`;
  const stored = await browser.storage.local.get(key);
  const record = stored[key];
  if (
    !(
      typeof record === 'object' &&
      record !== null &&
      'provisional' in record &&
      record.provisional === true &&
      'ownershipToken' in record &&
      record.ownershipToken === ownership.ownershipToken &&
      'expectedChannel' in record &&
      record.expectedChannel === ownership.expectedChannel
    )
  )
    return null;
  return {
    provisional: true,
    ...('replacesOwnershipToken' in record &&
    typeof record.replacesOwnershipToken === 'string' &&
    record.replacesOwnershipToken.length > 0 &&
    record.replacesOwnershipToken !== ownership.ownershipToken
      ? { replacesOwnershipToken: record.replacesOwnershipToken }
      : {}),
  };
}

export async function forgetManagedWatch(ownershipToken: string): Promise<void> {
  await browser.storage.local.remove(`${PREFIX}${ownershipToken}`);
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
