import { inspectManagedWatchMarker } from './managed-watch-marker.ts';
import { listManagedWatches } from './managed-watch-registry.ts';
import {
  type ManagedTabOwnershipOperations,
  recoverManagedTabOwnership,
  streamerWatchUrl,
} from './tab-management.ts';

// Retained farming tabs remain managed even when the active transport is hidden.
export async function resolveManagedWatchTabIds(
  operations: ManagedTabOwnershipOperations,
): Promise<readonly number[] | null> {
  try {
    const registered = await listManagedWatches();
    const ids = new Set<number>();
    for (const ownership of registered) {
      const recovered = await recoverManagedTabOwnership(ownership, operations, true);
      if (recovered) {
        ids.add(recovered.tabId);
        continue;
      }
      const marker = await inspectManagedWatchMarker(
        ownership.ownershipToken,
        streamerWatchUrl(ownership.expectedChannel),
      );
      if (marker.kind === 'unavailable' || marker.kind === 'ambiguous') return null;
      if (marker.kind === 'found') ids.add(marker.tab.id);
    }
    return [...ids];
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}
