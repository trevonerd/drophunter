import { inspectManagedWatchMarker } from './managed-watch-marker.ts';
import { forgetManagedWatch, listManagedWatches } from './managed-watch-registry.ts';
import {
  type ManagedTabOwnershipOperations,
  releaseManagedTabOwnership,
  streamerWatchUrl,
} from './tab-management.ts';

export async function reconcileManagedWatchesBeforeCreate(
  operations: ManagedTabOwnershipOperations,
  preservedToken: string | null,
  isCurrent: () => boolean,
): Promise<boolean> {
  for (const ownership of await listManagedWatches()) {
    if (!isCurrent()) return false;
    if (ownership.ownershipToken === preservedToken) continue;
    const result = await inspectManagedWatchMarker(
      ownership.ownershipToken,
      streamerWatchUrl(ownership.expectedChannel),
    );
    if (!isCurrent()) return false;
    if (result.kind === 'unavailable' || result.kind === 'ambiguous') return false;
    if (result.kind === 'missing') {
      await forgetManagedWatch(ownership.ownershipToken);
      continue;
    }
    const released = await releaseManagedTabOwnership({ ...ownership, tabId: result.tab.id }, operations);
    if (released.kind === 'abandoned-unproven') return false;
  }
  return isCurrent();
}
