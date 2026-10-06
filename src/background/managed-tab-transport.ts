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
  readonly isCurrent?: () => boolean;
  readonly confirmOwnership?: (
    tabId: number,
    ownershipToken: string,
    expectedUrl: string,
  ) => Promise<boolean>;
  readonly createOwnershipToken: () => string;
  readonly persistOwnership: (token: string, expectedUrl: string) => Promise<boolean>;
  readonly discardOwnership: (token: string) => Promise<void>;
  readonly openTab: (expectedUrl: string) => Promise<{
    readonly id?: number;
    readonly restorePrevious?: () => Promise<void>;
  } | null>;
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
  const isCurrent = operations.isCurrent ?? (() => true);
  if (!isCurrent()) return null;
  const ownershipToken = operations.createOwnershipToken();
  if (!(await operations.persistOwnership(ownershipToken, expectedUrl))) return null;
  if (!isCurrent()) {
    await operations.discardOwnership(ownershipToken);
    return null;
  }
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
  const dispose = async (): Promise<void> => {
    if (tab.restorePrevious) {
      await operations.discardOwnership(ownershipToken);
      await tab.restorePrevious();
      return;
    }
    await operations.release(ownership);
  };
  let probe: WatchProbeResult = { accepted: false, reason: 'error' };
  let preparation: PlaybackPrepResult = {};
  let prepared = false;
  try {
    if (isCurrent()) await operations.waitForTabComplete(tabId, 15_000);
    if (
      isCurrent() &&
      operations.confirmOwnership &&
      !(await operations.confirmOwnership(tabId, ownershipToken, expectedUrl))
    ) {
      return {
        target,
        ownership,
        health: createWatchHealth('managed-tab', 'failed', 'error', operations.now),
        dispose,
      };
    }
    if (isCurrent())
      preparation = await operations.preparePlayback(tabId, {
        activateTab: false,
        unmuteTab: false,
        muteAfterPrep: true,
      });
    if (isCurrent()) probe = await operations.probe(ownership, target);
    prepared = isCurrent();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  const hasDropsEligibilityProof =
    probe.isLive === true && probe.sameChannel === true && probe.sameGame === true;
  const dropsSignalIsAcceptable = probe.hasDropsSignal !== false || hasDropsEligibilityProof;
  const healthy =
    prepared && preparation.isPlaybackReady === true && dropsSignalIsAcceptable && isHealthyWatchProbe(probe);
  const awaitingInteraction =
    prepared &&
    preparation.isPlaybackReady !== true &&
    preparation.userInteractionRequired === true &&
    probe.isLive !== false &&
    probe.sameChannel !== false &&
    probe.sameGame !== false;
  const status = healthy
    ? probe.hasDropsSignal === false
      ? 'degraded'
      : 'healthy'
    : awaitingInteraction
      ? 'degraded'
      : 'failed';
  const reason = healthy
    ? probe.hasDropsSignal === false
      ? 'drops-inactive'
      : reasonForWatchProbe(probe)
    : awaitingInteraction
      ? 'user-interaction-required'
      : preparation.isPlaybackReady !== true
        ? 'playback-inactive'
        : reasonForWatchProbe(probe);
  const health = createWatchHealth('managed-tab', status, reason, operations.now);
  return {
    target,
    ownership,
    health,
    dispose,
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
  private awaitingInteraction = false;

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
    this.awaitingInteraction = health.reason === 'user-interaction-required';
    return true;
  }

  currentOwnership(): WatchOwnershipV1 | null {
    return this.session?.ownership ?? null;
  }

  async start(target: FarmingTarget, isCurrent: () => boolean = () => true): Promise<WatchHealth> {
    const previousSession = this.session;
    const previousTarget = this.target;
    const session = await this.operations.open(target, { active: false, focus: false, isCurrent });
    if (!isManagedSession(session)) {
      if (!previousSession) this.target = target;
      else this.target = previousTarget;
      this.session = previousSession;
      return createWatchHealth(this.mode, 'failed', 'managed-tab-unavailable', this.now, {
        shouldFallback: true,
      });
    }
    let health = session.health;
    if (health) {
      let probe: WatchProbeResult;
      try {
        probe = await this.operations.probe(session, target);
      } catch {
        return createWatchHealth(this.mode, 'failed', 'error', this.now);
      }
      const awaitingInteraction = health.reason === 'user-interaction-required';
      if (
        !isCurrent() ||
        probe.isLive === false ||
        probe.sameChannel === false ||
        probe.sameGame === false ||
        (!awaitingInteraction && !isHealthyWatchProbe(probe))
      ) {
        return createWatchHealth(this.mode, 'failed', reasonForWatchProbe(probe), this.now);
      }
      if (awaitingInteraction && isHealthyWatchProbe(probe)) {
        health = createWatchHealth(this.mode, 'healthy', reasonForWatchProbe(probe), this.now);
      }
    }
    this.target = target;
    this.session = session;
    this.consecutiveFailures = 0;
    this.progress = null;
    this.awaitingInteraction = health?.reason === 'user-interaction-required';
    return health ?? createWatchHealth(this.mode, 'healthy', 'started', this.now);
  }

  async tick(): Promise<WatchHealth> {
    if (!this.session && this.target) {
      return createWatchHealth(this.mode, 'failed', 'managed-tab-unavailable', this.now, {
        shouldFallback: true,
      });
    }
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
    if (
      this.awaitingInteraction &&
      !probe.accepted &&
      probe.isLive !== false &&
      probe.sameChannel !== false &&
      probe.sameGame !== false &&
      (!probe.reason || probe.reason === 'playback-inactive')
    ) {
      return createWatchHealth(this.mode, 'degraded', 'user-interaction-required', this.now, {
        progress: this.progress,
      });
    }
    this.awaitingInteraction = false;
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
    this.target = null;
    this.consecutiveFailures = 0;
    this.progress = null;
    this.awaitingInteraction = false;
  }
}
