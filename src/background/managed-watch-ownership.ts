import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { resolveManagedWatchTabIds } from './managed-watch-observation.ts';
import {
  clearManagedNavigationVersion,
  managedTabOwnershipKey,
  releaseManagedTabOwnership,
  retireManagedTabOwnership,
  streamerWatchUrl,
} from './managed-watch-ownership-proof.ts';
import {
  type ManagedWatchStartupSelection,
  reconstructManagedWatchOwnership,
} from './managed-watch-ownership-reconstruction.ts';
import { listManagedWatches, rememberManagedWatch } from './managed-watch-registry.ts';
import type { WatchReleaseResult } from './watch-transport-transition.ts';

type ManagedOwnership = Extract<WatchOwnershipV1, { kind: 'managed-tab' }>;

export interface ManagedWatchCandidate {
  readonly ownership: ManagedOwnership;
  confirm(): Promise<boolean>;
  discard(): Promise<void>;
}

export interface ManagedWatchAcquisitionIntent {
  readonly allowInitialCreation?: boolean;
  readonly preserveExistingWatch?: boolean;
  readonly retainOnFailure?: boolean;
  readonly purpose?: 'watch' | 'selection';
  readonly knownTabId?: number | null;
  readonly isCurrent?: () => boolean;
}

export interface ManagedWatchOwnership {
  acquire(channel: string, intent?: ManagedWatchAcquisitionIntent): Promise<ManagedWatchCandidate | null>;
  finalize(ownership: WatchOwnershipV1): Promise<void>;
  release(ownership: WatchOwnershipV1): Promise<WatchReleaseResult>;
  reconstruct(
    receipt: WatchOwnershipV1 | null,
    readSelection: () => ManagedWatchStartupSelection,
    isCurrent: () => boolean,
  ): Promise<WatchOwnershipV1 | null>;
  observeTabIds(): Promise<readonly number[] | null>;
}

interface ManagedWatchOwnershipDependencies {
  readonly host: FarmingAutomationChromeHost;
  readonly currentOwnership?: () => WatchOwnershipV1 | null;
  readonly waitForTabComplete: (tabId: number, timeoutMs: number) => Promise<void>;
  readonly createOwnershipToken?: () => string;
  readonly recordDurableOwnership?: boolean;
}

async function attempt<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function createManagedWatchOwnership(
  dependencies: ManagedWatchOwnershipDependencies,
): ManagedWatchOwnership {
  const { host } = dependencies;
  const currentOwnership = dependencies.currentOwnership ?? (() => null);
  const finalize = async (ownership: WatchOwnershipV1): Promise<void> => {
    if (ownership.kind === 'managed-tab' && dependencies.recordDurableOwnership)
      await rememberManagedWatch(
        ownership.tabId,
        ownership.ownershipToken,
        streamerWatchUrl(ownership.expectedChannel),
      );
  };
  const release = async (ownership: WatchOwnershipV1): Promise<WatchReleaseResult> => {
    if (ownership.kind === 'tabless') return { kind: 'not-required' };
    const current = currentOwnership();
    if (
      current?.kind === 'managed-tab' &&
      current.tabId === ownership.tabId &&
      current.ownershipToken !== ownership.ownershipToken
    ) {
      await retireManagedTabOwnership(ownership.ownershipToken, host);
      return { kind: 'not-required' };
    }
    const result = await releaseManagedTabOwnership(ownership, host, {
      discard: current?.kind === 'managed-tab' && current.tabId !== ownership.tabId,
    });
    const settled = currentOwnership();
    if (
      result.kind === 'released' &&
      current?.kind === 'managed-tab' &&
      settled?.kind === 'managed-tab' &&
      settled.ownershipToken === current.ownershipToken
    )
      await finalize(current);
    return result;
  };
  const acquire = async (
    channel: string,
    intent: ManagedWatchAcquisitionIntent = {},
  ): Promise<ManagedWatchCandidate | null> => {
    const isCurrent = intent.isCurrent ?? (() => true);
    if (!isCurrent()) return null;
    if (intent.purpose === 'selection' && intent.knownTabId != null) {
      const tabs = await attempt(() => host.tabs.query({}));
      if (!tabs) return null;
      const registered = await listManagedWatches();
      if (
        tabs.some((tab) => tab.id === intent.knownTabId) &&
        !registered.some((item) => item.tabId === intent.knownTabId)
      )
        return null;
    }
    const token = (dependencies.createOwnershipToken ?? (() => globalThis.crypto.randomUUID()))();
    const expectedUrl = streamerWatchUrl(channel);
    const key = managedTabOwnershipKey(token);
    const incumbent = currentOwnership();
    const preparation =
      intent.preserveExistingWatch && incumbent?.kind === 'managed-tab'
        ? { provisional: true as const, replacesOwnershipToken: incumbent.ownershipToken }
        : {};
    let handedOff = false;
    try {
      const persisted = await attempt(async () => {
        await host.sessionStorage.set({ [key]: { version: 1, expectedUrl, ...preparation } });
        return true;
      });
      if (!persisted || !isCurrent()) return null;
      const tab = await attempt(() =>
        host.tabs.create(
          { url: expectedUrl, active: false, muted: true },
          isCurrent,
          intent.allowInitialCreation ?? false,
          intent.preserveExistingWatch ?? false,
        ),
      );
      if (typeof tab?.id !== 'number') return null;
      const ownership: ManagedOwnership = {
        kind: 'managed-tab',
        tabId: tab.id,
        ownershipToken: token,
        expectedChannel: channel,
      };
      let disposal: Promise<void> | null = null;
      let confirmation: Promise<boolean> | null = null;
      let confirmed = false;
      const candidate: ManagedWatchCandidate = {
        ownership,
        confirm: () => {
          if (disposal) return Promise.resolve(false);
          confirmation ??= (async () => {
            if (isCurrent()) await dependencies.waitForTabComplete(ownership.tabId, 15_000);
            if (!isCurrent() || disposal) return false;
            if (host.managedWatchMarker) {
              if (!(await host.managedWatchMarker.write(ownership.tabId, token, expectedUrl))) return false;
              if (intent.preserveExistingWatch && dependencies.recordDurableOwnership)
                await rememberManagedWatch(ownership.tabId, token, expectedUrl, preparation);
            }
            confirmed = isCurrent() && disposal === null;
            return confirmed;
          })();
          return confirmation;
        },
        discard: () => {
          disposal ??= Promise.resolve().then(async () => {
            await confirmation?.catch(() => false);
            if (tab.restorePrevious) {
              await retireManagedTabOwnership(ownership.ownershipToken, host);
              await tab.restorePrevious();
            } else if (intent.retainOnFailure) {
              await releaseManagedTabOwnership(ownership, host, { discard: intent.preserveExistingWatch });
            } else {
              await release(ownership);
            }
          });
          return disposal;
        },
      };
      if (intent.purpose === 'selection' && tab.restorePrevious && !(await candidate.confirm())) {
        await candidate.discard();
        return null;
      }
      handedOff = true;
      return candidate;
    } finally {
      if (!handedOff) await retireManagedTabOwnership(token, host);
    }
  };
  return {
    acquire,
    finalize,
    release,
    reconstruct: (receipt, readSelection, isCurrent) =>
      reconstructManagedWatchOwnership(host, receipt, readSelection, isCurrent),
    observeTabIds: () => resolveManagedWatchTabIds(host),
  };
}

export async function closeManagedTabIfSafe(tabId: number | null): Promise<boolean> {
  if (tabId !== null) clearManagedNavigationVersion(tabId);
  return false;
}
