import type { DropsSnapshot } from '../types/index.ts';
import type { DropsSnapshotProvenance } from './drops-projection-semantics.ts';

export function snapshotProvenance(snapshot: DropsSnapshot): DropsSnapshotProvenance {
  if (snapshot.campaignsVerified === true) return 'campaign-authoritative';
  if (snapshot.campaignsVerified === false && snapshot.inventoryVerified === true) {
    return 'inventory-partial';
  }
  return 'cached';
}
