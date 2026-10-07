import type { PlaybackPrepResult } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ManagedWatchOwnership } from './managed-watch-ownership.ts';
import {
  createManagedWatchPreparationHealth,
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
import type { ProvisionalWatchCandidate } from './watch-transport-transition.ts';

export type ManagedPlaybackPreparation = {
  readonly isCurrent?: () => boolean;
  readonly activateTab: false;
  readonly unmuteTab: false;
  readonly muteAfterPrep: true;
};

type ManagedOwnership = Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>;

export interface ManagedProvisionalWatchOperations {
  readonly isCurrent?: () => boolean;
  readonly ownership: Pick<ManagedWatchOwnership, 'acquire'>;
  readonly allowInitialCreation?: boolean;
  readonly preparePlayback: (
    tabId: number,
    options: ManagedPlaybackPreparation,
  ) => Promise<PlaybackPrepResult>;
  readonly probe: (ownership: ManagedOwnership, target: FarmingTarget) => Promise<WatchProbeResult>;
  readonly now: () => number;
}

export async function prepareManagedProvisionalWatch(
  target: FarmingTarget,
  operations: ManagedProvisionalWatchOperations,
): Promise<ProvisionalWatchCandidate | null> {
  const isCurrent = operations.isCurrent ?? (() => true);
  if (!isCurrent()) return null;
  const candidate = await operations.ownership.acquire(target.channelName, {
    isCurrent,
    allowInitialCreation: operations.allowInitialCreation,
  });
  if (!candidate) return null;
  const ownership = candidate.ownership;
  const tabId = ownership.tabId;
  const dispose = candidate.discard;
  let probe: WatchProbeResult = { accepted: false, reason: 'error' };
  let preparation: PlaybackPrepResult = {};
  let prepared = false;
  try {
    if (!(await candidate.confirm())) {
      return {
        target,
        ownership,
        health: createWatchHealth('managed-tab', 'failed', 'managed-tab-unavailable', operations.now),
        dispose,
      };
    }
    if (isCurrent())
      preparation = await operations.preparePlayback(tabId, {
        activateTab: false,
        unmuteTab: false,
        muteAfterPrep: true,
        isCurrent,
      });
    if (isCurrent()) probe = await operations.probe(ownership, target);
    prepared = isCurrent();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  return {
    target,
    ownership,
    health: createManagedWatchPreparationHealth(preparation, probe, prepared, operations.now),
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
  private generation = 0;

  constructor(options: ManagedTabTransportOptions) {
    this.operations = options;
    this.now = options.now ?? Date.now;
    this.failedProbeLimit = Math.max(1, Math.floor(options.failedProbeLimit ?? 3));
  }

  adopt(target: FarmingTarget, ownership: WatchOwnershipV1, health: WatchHealth): boolean {
    if (ownership.kind !== 'managed-tab') return false;
    this.generation++;
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
    const generation = ++this.generation;
    const ownsStart = () => isCurrent() && generation === this.generation;
    const previousSession = this.session;
    const previousTarget = this.target;
    const session = await this.operations.open(target, { active: false, focus: false, isCurrent: ownsStart });
    if (!ownsStart()) {
      if (isManagedSession(session)) await this.operations.pause?.(session);
      return createWatchHealth(this.mode, 'stopped', 'stopped', this.now);
    }
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
        await this.operations.pause?.(session);
        return createWatchHealth(this.mode, 'failed', 'error', this.now);
      }
      const awaitingInteraction = health.reason === 'user-interaction-required';
      const awaitingPlayback = health.reason === 'playback-pending';
      if (
        !ownsStart() ||
        probe.isLive === false ||
        probe.sameChannel === false ||
        probe.sameGame === false ||
        (!awaitingInteraction && !awaitingPlayback && !isHealthyWatchProbe(probe))
      ) {
        await this.operations.pause?.(session);
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
    const generation = this.generation;
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
      if (generation !== this.generation) return createWatchHealth(this.mode, 'stopped', 'stopped', this.now);
      this.consecutiveFailures += 1;
      return createWatchHealth(this.mode, 'failed', 'error', this.now, {
        consecutiveFailures: this.consecutiveFailures,
        progress: this.progress,
        shouldFallback: this.consecutiveFailures >= this.failedProbeLimit,
      });
    }
    if (generation !== this.generation) return createWatchHealth(this.mode, 'stopped', 'stopped', this.now);
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
    this.generation++;
    const session = this.session;
    this.target = null;
    this.consecutiveFailures = 0;
    this.progress = null;
    this.awaitingInteraction = false;
    if (session) await this.operations.pause?.(session);
  }
}
