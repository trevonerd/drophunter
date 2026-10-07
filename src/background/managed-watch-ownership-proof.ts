import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { type ManagedWatchMarker, pauseManagedWatch } from './managed-watch-marker.ts';
import { waitForTabComplete } from './tab-management.ts';
import type { WatchReleaseResult } from './watch-transport-transition.ts';

const FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX = 'farmingAutomationOwnedWatch:';

type ManagedWatchOwnership = Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>;

export interface ManagedTabOwnershipOperations {
  readonly managedWatchMarker?: ManagedWatchMarker;
  readonly tabs: {
    get(tabId: number): Promise<{
      readonly id?: number;
      readonly windowId?: number;
      readonly url?: string;
      readonly pendingUrl?: string;
      readonly status?: string;
    } | null>;
    query(query: { readonly windowId?: number }): Promise<readonly { readonly id?: number }[]>;
    update(
      tabId: number,
      properties: { readonly url: string; readonly active: false; readonly muted: true },
      isCurrent?: () => boolean | Promise<boolean>,
    ): Promise<void>;
    remove(tabId: number, isCurrent?: () => boolean | Promise<boolean>): Promise<void>;
  };
  readonly sessionStorage: {
    get(key: string): Promise<Readonly<Record<string, unknown>>>;
    remove(key: string): Promise<void>;
  };
}

export function managedTabOwnershipKey(token: string): string {
  return `${FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX}${token}`;
}

function isStoredOwnershipProof(value: unknown, expectedUrl: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'expectedUrl' in value &&
    value.expectedUrl === expectedUrl
  );
}

async function attemptOwnedTabOperation<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export async function recoverManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
  includePending = false,
  allowNavigation = false,
): Promise<ManagedWatchOwnership | null> {
  const key = managedTabOwnershipKey(ownership.ownershipToken);
  const stored = await attemptOwnedTabOperation(() => operations.sessionStorage.get(key));
  const expectedUrl = streamerWatchUrl(ownership.expectedChannel);
  const sessionProof = stored && isStoredOwnershipProof(stored[key], expectedUrl);
  const proof = stored?.[key];
  const opening = typeof proof === 'object' && proof !== null && 'opening' in proof && proof.opening === true;
  const tab = sessionProof
    ? await attemptOwnedTabOperation(() => operations.tabs.get(ownership.tabId))
    : null;
  if (
    tab?.id === ownership.tabId &&
    typeof tab.windowId === 'number' &&
    (tab.url === expectedUrl ||
      (includePending &&
        tab.url === 'about:blank' &&
        (tab.pendingUrl === expectedUrl || (opening && !tab.pendingUrl))))
  )
    return ownership;
  const marked = await operations.managedWatchMarker
    ?.locate(ownership.ownershipToken, expectedUrl, allowNavigation)
    .catch(() => null);
  return typeof marked?.id === 'number' &&
    (marked.url === expectedUrl || (allowNavigation && marked.url?.startsWith('https://www.twitch.tv/'))) &&
    typeof marked.windowId === 'number'
    ? { ...ownership, tabId: marked.id }
    : null;
}

export type ReusedManagedTab = {
  readonly id: number;
  readonly reused: true;
};

export async function retireManagedTabOwnership(
  ownershipToken: string,
  operations: ManagedTabOwnershipOperations,
): Promise<void> {
  await attemptOwnedTabOperation(async () => {
    await operations.sessionStorage.remove(managedTabOwnershipKey(ownershipToken));
    return true;
  });
  await attemptOwnedTabOperation(async () => {
    await operations.managedWatchMarker?.forget?.(ownershipToken);
    return true;
  });
}

export async function reuseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  expectedUrl: string,
  operations: ManagedTabOwnershipOperations & {
    sessionStorage: { set(values: Readonly<Record<string, unknown>>): Promise<void> };
  },
  isCurrent: () => boolean = () => true,
): Promise<ReusedManagedTab | null> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true, true);
  if (!recovered || !isCurrent()) return null;
  const tab = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
  if (!tab || !isCurrent()) return null;
  const needsNavigation = tab.url !== expectedUrl && tab.pendingUrl !== expectedUrl;
  if (needsNavigation) {
    const navigated = await attemptOwnedTabOperation(async () => {
      await operations.tabs.update(
        recovered.tabId,
        { url: expectedUrl, active: false, muted: true },
        isCurrent,
      );
      return isCurrent();
    });
    if (!navigated) {
      const current = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
      if (current?.url !== expectedUrl && current?.pendingUrl !== expectedUrl) return null;
    }
  }
  if (!isCurrent()) {
    // Only finish proof for a navigation that actually reached our owned tab.
    const current = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
    if (current?.url !== expectedUrl && current?.pendingUrl !== expectedUrl) return null;
  }
  // Retain proof of our completed navigation even if the farming intent was
  // cancelled. The next acquisition must recover this tab instead of creating one.
  await operations.sessionStorage.set({
    [managedTabOwnershipKey(recovered.ownershipToken)]: { version: 1, expectedUrl },
  });
  if (needsNavigation) await waitForTabComplete(recovered.tabId, 15_000);
  const marked = await operations.managedWatchMarker?.write(
    recovered.tabId,
    recovered.ownershipToken,
    expectedUrl,
  );
  if (!isCurrent()) {
    await pauseManagedWatch({ ...recovered, expectedChannel: new URL(expectedUrl).pathname.slice(1) });
    return null;
  }
  return marked ? { id: recovered.tabId, reused: true } : null;
}

export async function releaseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
  options: { readonly discard?: boolean; readonly isCurrent?: () => boolean } = {},
): Promise<WatchReleaseResult> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true);
  if (!recovered) return { kind: 'abandoned-unproven' };
  if (options.discard) {
    const tab = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
    if (typeof tab?.windowId !== 'number') return { kind: 'abandoned-unproven' };
    const windowTabs = await attemptOwnedTabOperation(() =>
      operations.tabs.query({ windowId: tab.windowId }),
    );
    if (!windowTabs) return { kind: 'abandoned-unproven' };
    const stillOwned = async () => {
      if (options.isCurrent?.() === false) return false;
      const proof = await recoverManagedTabOwnership(recovered, operations, true);
      if (!proof || proof.tabId !== recovered.tabId) return false;
      if (operations.managedWatchMarker) {
        const marked = await operations.managedWatchMarker
          .locate(recovered.ownershipToken, streamerWatchUrl(recovered.expectedChannel))
          .catch(() => null);
        if (marked?.id !== recovered.tabId) return false;
      }
      const latest = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
      return (
        options.isCurrent?.() !== false &&
        latest !== null &&
        latest.windowId === tab.windowId &&
        latest.url === streamerWatchUrl(recovered.expectedChannel) &&
        !latest.pendingUrl
      );
    };
    if (!(await stillOwned())) return { kind: 'abandoned-unproven' };
    const requireOwnership = async () => {
      if (!(await stillOwned())) throw new Error('Managed tab ownership changed before cleanup');
      return true;
    };
    const requireSafeRemoval = async () => {
      await requireOwnership();
      const siblings = await operations.tabs.query({ windowId: tab.windowId });
      if (!siblings.some((other) => other.id !== recovered.tabId))
        throw new Error('Managed tab is the last tab in its window');
      return requireOwnership();
    };
    const closed =
      windowTabs.some((other) => other.id !== recovered.tabId) &&
      (await attemptOwnedTabOperation(async () => {
        await requireSafeRemoval();
        await operations.tabs.remove(recovered.tabId, requireSafeRemoval);
        return true;
      }));
    if (!closed) {
      const neutralized = await attemptOwnedTabOperation(async () => {
        await operations.tabs.update(
          recovered.tabId,
          { url: 'about:blank', active: false, muted: true },
          requireOwnership,
        );
        return true;
      });
      if (!neutralized) return { kind: 'abandoned-unproven' };
    }
    await retireManagedTabOwnership(recovered.ownershipToken, operations);
    return { kind: 'released', method: closed ? 'closed' : 'neutralized' };
  }
  return { kind: 'not-required' };
}

export function streamerWatchUrl(channelName: string): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  return `https://www.twitch.tv/${channel}`;
}
