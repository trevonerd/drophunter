import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { inspectManagedWatchMarker } from './managed-watch-marker.ts';
import { listManagedWatches } from './managed-watch-registry.ts';
import {
  type ManagedTabOwnershipOperations,
  recoverManagedTabOwnership,
  streamerWatchUrl,
} from './tab-management.ts';

type ManagedOwnership = Extract<WatchOwnershipV1, { kind: 'managed-tab' }>;
export type ManagedWatchPreflight =
  | { readonly kind: 'reuse'; readonly ownership: ManagedOwnership }
  | { readonly kind: 'create'; readonly previouslyOwned: boolean }
  | { readonly kind: 'blocked' };

export async function reconcileManagedWatchesBeforeCreate(
  operations: ManagedTabOwnershipOperations,
  currentOwnership: WatchOwnershipV1 | null,
  isCurrent: () => boolean,
): Promise<ManagedWatchPreflight> {
  const registered = await listManagedWatches();
  const handles = new Map(registered.map((item) => [item.ownershipToken, item]));
  if (currentOwnership?.kind === 'managed-tab')
    handles.set(currentOwnership.ownershipToken, currentOwnership);
  const tabs = await operations.tabs.query({});
  const recovered = new Map<number, ManagedOwnership>();
  for (const ownership of handles.values()) {
    if (!isCurrent()) return { kind: 'blocked' };
    const proven = await recoverManagedTabOwnership(ownership, operations, true);
    if (proven) {
      const tab = await operations.tabs.get(proven.tabId);
      if (tab?.status === 'loading' || tab?.pendingUrl) return { kind: 'blocked' };
      const previous = recovered.get(proven.tabId);
      if (
        !previous ||
        (currentOwnership?.kind === 'managed-tab' &&
          ownership.ownershipToken === currentOwnership.ownershipToken)
      )
        recovered.set(proven.tabId, proven);
      continue;
    }
    const result = await inspectManagedWatchMarker(
      ownership.ownershipToken,
      streamerWatchUrl(ownership.expectedChannel),
    );
    if (!isCurrent()) return { kind: 'blocked' };
    if (result.kind === 'unavailable' || result.kind === 'ambiguous') return { kind: 'blocked' };
    if (result.kind === 'missing') {
      if (tabs.some((tab) => tab.id === ownership.tabId)) return { kind: 'blocked' };
      continue;
    }
    recovered.set(result.tab.id, { ...ownership, tabId: result.tab.id });
  }
  if (!isCurrent() || recovered.size > 1) return { kind: 'blocked' };
  const ownership = recovered.values().next().value;
  return ownership ? { kind: 'reuse', ownership } : { kind: 'create', previouslyOwned: handles.size > 0 };
}
