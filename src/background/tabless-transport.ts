import type { WatchHealthStatus } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import {
  createWatchHealth,
  isHealthyWatchProbe,
  normalizeWatchProgress,
  reasonForWatchProbe,
} from './watch-health.ts';
import type {
  FarmingTarget,
  TablessHeartbeat,
  TablessTransportOptions,
  WatchHealth,
  WatchTransport,
} from './watch-transport.ts';
import type { ProvisionalWatchCandidate } from './watch-transport-transition.ts';

export const TABLESS_HEARTBEAT_FAILURE_LIMIT = 5;

export interface TablessProvisionalWatchOptions {
  readonly enabled: boolean;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly now: () => number;
}

export function tablessTargetKey(target: FarmingTarget): string {
  if (target.campaignId) return `campaign:${target.campaignId}`;
  if (target.selectionId) return `selection:${target.selectionId}`;
  return `game:${target.gameId}`;
}

export async function prepareTablessProvisionalWatch(
  target: FarmingTarget,
  options: TablessProvisionalWatchOptions,
): Promise<ProvisionalWatchCandidate | null> {
  if (!options.enabled) return null;
  let heartbeat: TablessHeartbeat;
  try {
    heartbeat = await options.heartbeat(target);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
  const healthy = isHealthyWatchProbe(heartbeat);
  const health = createWatchHealth(
    'tabless',
    healthy ? (heartbeat.hasDropsSignal === false ? 'degraded' : 'healthy') : 'failed',
    reasonForWatchProbe(heartbeat),
    options.now,
  );
  const ownership: WatchOwnershipV1 = { kind: 'tabless', targetKey: tablessTargetKey(target) };
  return { target, ownership, health, dispose: () => Promise.resolve() };
}

export class TablessTransport implements WatchTransport {
  readonly mode = 'tabless' as const;

  private readonly options: TablessTransportOptions;
  private readonly now: () => number;
  private readonly failedHeartbeatLimit: number;
  private readonly stalledProgressHeartbeats: number;
  private target: FarmingTarget | null = null;
  private consecutiveFailures = 0;
  private consecutiveStalls = 0;
  private progress: number | null = null;
  private fallbackIssued = false;
  private disabledHealth: WatchHealth | null = null;

  constructor(options: TablessTransportOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.failedHeartbeatLimit = Math.max(
      1,
      Math.floor(options.failedHeartbeatLimit ?? TABLESS_HEARTBEAT_FAILURE_LIMIT),
    );
    this.stalledProgressHeartbeats = Math.max(
      1,
      Math.floor(options.stalledProgressHeartbeats ?? TABLESS_HEARTBEAT_FAILURE_LIMIT),
    );
  }

  adopt(target: FarmingTarget, ownership: WatchOwnershipV1, health: WatchHealth): boolean {
    if (ownership.kind !== 'tabless') return false;
    this.target = target;
    this.consecutiveFailures = health.consecutiveFailures;
    this.consecutiveStalls = health.consecutiveStalls;
    this.progress = health.progress;
    this.fallbackIssued = health.shouldFallback;
    this.disabledHealth = health.status === 'disabled' ? health : null;
    return true;
  }

  currentOwnership(): WatchOwnershipV1 | null {
    return this.target === null ? null : { kind: 'tabless', targetKey: tablessTargetKey(this.target) };
  }

  async start(target: FarmingTarget): Promise<WatchHealth> {
    await this.stop();
    if (!this.options.enabled) {
      this.disabledHealth = createWatchHealth(this.mode, 'disabled', 'transport-disabled', this.now);
      return this.disabledHealth;
    }
    this.target = target;
    return this.readHeartbeat('started');
  }

  async tick(): Promise<WatchHealth> {
    if (!this.options.enabled) {
      this.disabledHealth ??= createWatchHealth(this.mode, 'disabled', 'transport-disabled', this.now);
      return this.disabledHealth;
    }
    if (!this.target) return createWatchHealth(this.mode, 'not-started', 'not-started', this.now);
    return this.readHeartbeat('heartbeat');
  }

  async stop(): Promise<void> {
    this.target = null;
    this.consecutiveFailures = 0;
    this.consecutiveStalls = 0;
    this.progress = null;
    this.fallbackIssued = false;
    this.disabledHealth = null;
  }

  private async readHeartbeat(defaultReason: 'started' | 'heartbeat'): Promise<WatchHealth> {
    if (!this.target) return createWatchHealth(this.mode, 'not-started', 'not-started', this.now);
    let probe: TablessHeartbeat;
    try {
      probe = await this.options.heartbeat(this.target);
    } catch {
      probe = { accepted: false, reason: 'error' };
    }
    const nextProgress = normalizeWatchProgress(probe.progress);
    const healthyProbe = isHealthyWatchProbe(probe);
    const hasProgress = nextProgress != null;
    const progressAdvanced = hasProgress && (this.progress == null || nextProgress > this.progress);
    if (!healthyProbe) {
      this.consecutiveFailures += 1;
      this.consecutiveStalls = 0;
    } else {
      this.consecutiveFailures = 0;
      if (progressAdvanced) this.consecutiveStalls = 0;
      else if (hasProgress && this.progress != null) this.consecutiveStalls += 1;
      else this.consecutiveStalls = 0;
    }
    if (nextProgress != null) this.progress = nextProgress;
    const stalled = this.consecutiveStalls >= this.stalledProgressHeartbeats;
    const shouldFallback = this.consecutiveFailures >= this.failedHeartbeatLimit || stalled;
    if (shouldFallback && !this.fallbackIssued) {
      this.fallbackIssued = true;
      await Promise.resolve(this.options.onFallback?.()).catch(() => undefined);
    }
    const reason = stalled
      ? 'stalled-progress'
      : reasonForWatchProbe(probe) === 'heartbeat' && defaultReason === 'started'
        ? 'started'
        : reasonForWatchProbe(probe);
    const status: WatchHealthStatus = stalled
      ? 'stalled'
      : healthyProbe && probe.hasDropsSignal === false
        ? 'degraded'
        : healthyProbe
          ? 'healthy'
          : 'failed';
    return createWatchHealth(this.mode, status, reason, this.now, {
      consecutiveFailures: this.consecutiveFailures,
      consecutiveStalls: this.consecutiveStalls,
      progress: this.progress,
      shouldFallback,
    });
  }
}

export function createTablessTransport(options: TablessTransportOptions): WatchTransport {
  return new TablessTransport(options);
}
