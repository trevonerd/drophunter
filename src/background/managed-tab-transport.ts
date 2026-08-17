import type { PlaybackPrepResult } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import {
  createWatchHealth,
  isHealthyWatchProbe,
  normalizeWatchProgress,
  reasonForWatchProbe,
} from './watch-health.ts';
import type {
  FarmingTarget,
  ManagedTabOpenResult,
  ManagedTabOperations,
  ManagedTabSession,
  ManagedTabTransportOptions,
  WatchHealth,
  WatchProbeResult,
  WatchTransport,
} from './watch-transport.ts';
import type { ProvisionalWatchCandidate, WatchReleaseResult } from './watch-transport-transition.ts';

export type ManagedPlaybackPreparation = {
  readonly activateTab: false;
  readonly unmuteTab: false;
  readonly muteAfterPrep: true;
};

type ManagedWatchOwnership = Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>;

export interface ManagedProvisionalWatchOperations {
  readonly createOwnershipToken: () => string;
  readonly persistOwnership: (token: string, expectedUrl: string) => Promise<boolean>;
  readonly discardOwnership: (token: string) => Promise<void>;
  readonly openTab: (expectedUrl: string) => Promise<{ readonly id?: number } | null>;
  readonly waitForTabComplete: (tabId: number, timeoutMs: number) => Promise<void>;
  readonly preparePlayback: (
    tabId: number,
    options: ManagedPlaybackPreparation,
  ) => Promise<PlaybackPrepResult>;
  readonly probe: (ownership: ManagedWatchOwnership, target: FarmingTarget) => Promise<WatchProbeResult>;
  readonly release: (ownership: ManagedWatchOwnership) => Promise<WatchReleaseResult>;
  readonly now: () => number;
}

export async function prepareManagedProvisionalWatch(
  target: FarmingTarget,
  expectedUrl: string,
  operations: ManagedProvisionalWatchOperations,
): Promise<ProvisionalWatchCandidate | null> {
  const ownershipToken = operations.createOwnershipToken();
  if (!(await operations.persistOwnership(ownershipToken, expectedUrl))) return null;
  const tab = await operations.openTab(expectedUrl);
  if (typeof tab?.id !== 'number') {
    await operations.discardOwnership(ownershipToken);
    return null;
  }
  const tabId = tab.id;
  const ownership: ManagedWatchOwnership = {
    kind: 'managed-tab',
    tabId,
    ownershipToken,
    expectedChannel: target.channelName,
  };
  let probe: WatchProbeResult = { accepted: false, reason: 'error' };
  let prepared = false;
  try {
    await operations.waitForTabComplete(tabId, 15_000);
    await operations.preparePlayback(tabId, {
      activateTab: false,
      unmuteTab: false,
      muteAfterPrep: true,
    });
    probe = await operations.probe(ownership, target);
    prepared = true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  const healthy = prepared && isHealthyWatchProbe(probe);
  const health = createWatchHealth(
    'managed-tab',
    healthy ? (probe.hasDropsSignal === false ? 'degraded' : 'healthy') : 'failed',
    healthy ? reasonForWatchProbe(probe) : 'error',
    operations.now,
  );
  return {
    target,
    ownership,
    health,
    dispose: async () => {
      await operations.release(ownership);
    },
  };
}

function isManagedSession(session: ManagedTabOpenResult): session is ManagedTabSession {
  return session?.owner === 'drophunter' && Number.isInteger(session.tabId) && session.tabId >= 0;
}

export class ManagedTabTransport implements WatchTransport {
  readonly mode = 'managed-tab' as const;

  private readonly operations: ManagedTabOperations;
  private readonly now: () => number;
  private readonly failedProbeLimit: number;
  private session: ManagedTabSession | null = null;
  private target: FarmingTarget | null = null;
  private consecutiveFailures = 0;
  private progress: number | null = null;

  constructor(options: ManagedTabTransportOptions) {
    this.operations = options;
    this.now = options.now ?? Date.now;
    this.failedProbeLimit = Math.max(1, Math.floor(options.failedProbeLimit ?? 3));
  }

  adopt(target: FarmingTarget, ownership: WatchOwnershipV1, health: WatchHealth): boolean {
    if (ownership.kind !== 'managed-tab') return false;
    this.target = target;
    this.session = { owner: 'drophunter', tabId: ownership.tabId, ownership };
    this.consecutiveFailures = health.consecutiveFailures;
    this.progress = health.progress;
    return true;
  }

  currentOwnership(): WatchOwnershipV1 | null {
    return this.session?.ownership ?? null;
  }

  async start(target: FarmingTarget): Promise<WatchHealth> {
    if (this.session) await this.stop();
    const session = await this.operations.open(target, { active: false, focus: false });
    if (!isManagedSession(session)) {
      this.target = null;
      this.session = null;
      return createWatchHealth(this.mode, 'failed', 'managed-tab-unavailable', this.now);
    }
    this.target = target;
    this.session = session;
    this.consecutiveFailures = 0;
    this.progress = null;
    return createWatchHealth(this.mode, 'healthy', 'started', this.now);
  }

  async tick(): Promise<WatchHealth> {
    if (!this.session || !this.target) {
      return createWatchHealth(this.mode, 'not-started', 'not-started', this.now);
    }
    let probe: WatchProbeResult;
    try {
      probe = await this.operations.probe(this.session, this.target);
    } catch {
      this.consecutiveFailures += 1;
      return createWatchHealth(this.mode, 'failed', 'error', this.now, {
        consecutiveFailures: this.consecutiveFailures,
        progress: this.progress,
        shouldFallback: this.consecutiveFailures >= this.failedProbeLimit,
      });
    }
    const nextProgress = normalizeWatchProgress(probe.progress);
    this.consecutiveFailures = isHealthyWatchProbe(probe) ? 0 : this.consecutiveFailures + 1;
    if (nextProgress != null) this.progress = nextProgress;
    const healthy = isHealthyWatchProbe(probe);
    const status = healthy && probe.hasDropsSignal === false ? 'degraded' : healthy ? 'healthy' : 'failed';
    return createWatchHealth(this.mode, status, reasonForWatchProbe(probe), this.now, {
      consecutiveFailures: this.consecutiveFailures,
      progress: this.progress,
      shouldFallback: this.consecutiveFailures >= this.failedProbeLimit,
    });
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.target = null;
    this.consecutiveFailures = 0;
    this.progress = null;
    if (session) await this.operations.close(session);
  }
}
