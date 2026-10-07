import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { inspectManagedWatchMarker } from './managed-watch-marker.ts';
import {
  recoverManagedTabOwnership,
  releaseManagedTabOwnership,
  streamerWatchUrl,
} from './managed-watch-ownership-proof.ts';
import {
  getManagedWatchPreparation,
  isProvisionalManagedWatch,
  listManagedWatches,
  rememberManagedWatch,
} from './managed-watch-registry.ts';

export interface ManagedWatchStartupSelection {
  readonly running: boolean;
  readonly activeChannel: string | null;
  readonly tabId: number | null;
}

export async function reconstructManagedWatchOwnership(
  host: FarmingAutomationChromeHost,
  receiptOwnership: WatchOwnershipV1 | null,
  readSelection: () => ManagedWatchStartupSelection,
  isCurrent: () => boolean,
): Promise<WatchOwnershipV1 | null> {
  const registered = await listManagedWatches();
  const handles = new Map(registered.map((ownership) => [ownership.ownershipToken, ownership]));
  if (receiptOwnership?.kind === 'managed-tab')
    handles.set(receiptOwnership.ownershipToken, receiptOwnership);
  const recovered = [];
  for (const ownership of handles.values()) {
    const current = await recoverManagedTabOwnership(ownership, host);
    if (current) recovered.push(current);
  }
  const selection = readSelection();
  const matching = recovered.filter(
    (ownership) =>
      selection.running &&
      isCurrent() &&
      ownership.expectedChannel.toLowerCase() === selection.activeChannel?.toLowerCase(),
  );
  const selected =
    matching.find((ownership) => ownership.tabId === selection.tabId) ??
    (matching.length === 1 ? (matching[0] ?? null) : recovered.length === 1 ? (recovered[0] ?? null) : null);
  if (selected && isCurrent()) {
    const selectedPreparation = await getManagedWatchPreparation(selected);
    if (!isCurrent()) return null;
    let predecessorRetained = false;
    if (matching.includes(selected)) {
      for (const ownership of recovered) {
        if (!isCurrent()) return null;
        if (ownership.ownershipToken === selected.ownershipToken || ownership.tabId === selected.tabId)
          continue;
        const predecessor = ownership.ownershipToken === selectedPreparation?.replacesOwnershipToken;
        if (!predecessor && !(await isProvisionalManagedWatch(ownership))) continue;
        const marker = await inspectManagedWatchMarker(
          ownership.ownershipToken,
          streamerWatchUrl(ownership.expectedChannel),
        );
        if (!isCurrent()) return null;
        if (marker.kind === 'found' && marker.tab.id === ownership.tabId) {
          const release = await releaseManagedTabOwnership(ownership, host, { discard: true });
          if (predecessor && release.kind !== 'released') predecessorRetained = true;
        } else if (predecessor) predecessorRetained = true;
      }
    }
    await rememberManagedWatch(
      selected.tabId,
      selected.ownershipToken,
      streamerWatchUrl(selected.expectedChannel),
      predecessorRetained && selectedPreparation ? selectedPreparation : {},
      isCurrent,
    );
    if (isCurrent()) {
      return selected;
    }
  }
  return receiptOwnership?.kind === 'tabless' ? receiptOwnership : null;
}
