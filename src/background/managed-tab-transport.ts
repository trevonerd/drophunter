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
