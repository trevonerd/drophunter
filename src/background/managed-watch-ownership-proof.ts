import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ManagedWatchMarker } from './managed-watch-marker.ts';
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
    ): Promise<void>;
    remove(tabId: number): Promise<void>;
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
    ?.locate(ownership.ownershipToken, expectedUrl)
    .catch(() => null);
  return typeof marked?.id === 'number' && marked.url === expectedUrl && typeof marked.windowId === 'number'
    ? { ...ownership, tabId: marked.id }
    : null;
}

export type ReusedManagedTab = {
  readonly id: number;
  readonly restorePrevious: () => Promise<void>;
};

const managedNavigationVersions = new Map<number, symbol>();

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
  operations: ManagedTabOwnershipOperations,
  waitForComplete: (tabId: number, timeoutMs: number) => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<ReusedManagedTab | null> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true);
  if (!recovered || !isCurrent()) return null;
  const previousUrl = streamerWatchUrl(ownership.expectedChannel);
  const version = Symbol();
  managedNavigationVersions.set(recovered.tabId, version);
  const tab = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
  if (!tab || !isCurrent()) return null;
  const needsNavigation = tab.url !== expectedUrl && tab.pendingUrl !== expectedUrl;
  if (needsNavigation) {
    const navigated = await attemptOwnedTabOperation(async () => {
      await operations.tabs.update(recovered.tabId, { url: expectedUrl, active: false, muted: true });
      return true;
    });
    if (!navigated) return null;
  }

  const restorePrevious = async (): Promise<void> => {
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    const current = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    const stillOnReplacement =
      current?.id === recovered.tabId &&
      (current.url === expectedUrl || (current.url === 'about:blank' && current.pendingUrl === expectedUrl));
    if (!stillOnReplacement) return;
    if (needsNavigation && current?.url !== previousUrl) {
      const restored = await attemptOwnedTabOperation(async () => {
        await operations.tabs.update(recovered.tabId, {
          url: previousUrl,
          active: false,
          muted: true,
        });
        return true;
      });
      if (!restored) return;
      await waitForComplete(recovered.tabId, 15_000).catch(() => undefined);
    }
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    await operations.managedWatchMarker
      ?.write(recovered.tabId, ownership.ownershipToken, previousUrl)
      .catch(() => false);
  };

  if (!isCurrent()) {
    await restorePrevious();
    return null;
  }
  return { id: recovered.tabId, restorePrevious };
}

export async function releaseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
  options: { readonly discard?: boolean } = {},
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
    const closed =
      windowTabs.some((other) => other.id !== recovered.tabId) &&
      (await attemptOwnedTabOperation(async () => {
        await operations.tabs.remove(recovered.tabId);
        return true;
      }));
    if (!closed) {
      const neutralized = await attemptOwnedTabOperation(async () => {
        await operations.tabs.update(recovered.tabId, { url: 'about:blank', active: false, muted: true });
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

export function clearManagedNavigationVersion(tabId: number): void {
  managedNavigationVersions.delete(tabId);
}
