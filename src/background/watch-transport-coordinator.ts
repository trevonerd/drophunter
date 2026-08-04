import type { TwitchStreamer, WatchHealthSnapshot, WatchTransportMode } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  type FarmingTarget,
  type ManagedTabOpenResult,
  type ManagedTabOperations,
  ManagedTabTransport,
  type TablessHeartbeat,
  TablessTransport,
  type WatchHealth,
  type WatchProbeResult,
  type WatchTransport,
} from './watch-transport.ts';

export interface WatchTransportCoordinatorOptions {
  readonly state: ServiceWorkerState;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly managedTab: ManagedTabOperations;
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly minHeartbeatIntervalMs?: number;
  readonly persist: () => Promise<void>;
  readonly broadcast: () => void;
}

export interface WatchTransportCoordinator {
  readonly start: (streamer: TwitchStreamer) => Promise<WatchHealth>;
  readonly tick: () => Promise<WatchHealth>;
  readonly stop: () => Promise<void>;
  readonly setPreference: (mode: WatchTransportMode) => Promise<void>;
}

function targetFor(state: ServiceWorkerState, streamer: TwitchStreamer): FarmingTarget | null {
  const selected = state.appState.selectedGame;
  if (!selected || !streamer.name.trim()) {
    return null;
  }
  return {
    gameId: selected.categoryId ?? selected.id,
    selectionId: selected.id,
    campaignId: selected.campaignId,
    channelName: streamer.name,
  };
}

function streamHealth(progress: number | null, mode: WatchTransportMode, now: number): WatchHealthSnapshot {
  return {
    mode,
    isHealthy: false,
    status: 'not-started',
    reason: 'not-started',
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress,
    shouldFallback: false,
    checkedAt: now,
  };
}

export function createWatchTransportCoordinator(
  options: WatchTransportCoordinatorOptions,
): WatchTransportCoordinator {
  const state = options.state;
  const now = options.now ?? Date.now;
  const minHeartbeatIntervalMs = Math.max(1_000, options.minHeartbeatIntervalMs ?? 55_000);
  const tabless = new TablessTransport({
    enabled: options.enabled ?? true,
    heartbeat: options.heartbeat,
    now,
  });
  const managed = new ManagedTabTransport({ ...options.managedTab, now });
  let active: WatchTransport = managed;
  let target: FarmingTarget | null = null;
  let fallbackIssued = false;
  let lastTickAt = 0;

  const publish = (health: WatchHealthSnapshot) => {
    state.appState.watchTransportMode = health.mode;
    state.appState.watchHealth = health;
    options.broadcast();
  };

  const persist = async (health: WatchHealthSnapshot) => {
    publish(health);
    await options.persist();
  };

  const startManagedFallback = async (fallbackHealth: WatchHealth): Promise<WatchHealth> => {
    const nextTarget = target;
    if (!nextTarget) {
      await persist(fallbackHealth);
      return fallbackHealth;
    }
    await tabless.stop();
    active = managed;
    const health = await active.start(nextTarget);
    state.appState.watchFallbackReason = fallbackHealth.reason;
    await persist(health);
    return health;
  };

  const start = async (streamer: TwitchStreamer): Promise<WatchHealth> => {
    const nextTarget = targetFor(state, streamer);
    if (!nextTarget) {
      const health = streamHealth(state.appState.currentDrop?.currentMinutes ?? null, 'managed-tab', now());
      await persist(health);
      return health;
    }
    target = nextTarget;
    fallbackIssued = false;
    lastTickAt = 0;
    state.appState.watchFallbackReason = null;
    state.appState.activeStreamer = { ...streamer, isLive: true };
    state.appState.tabId = null;
    active = state.appState.watchTransportPreference === 'tabless' ? tabless : managed;
    const health = await active.start(nextTarget);
    if (health.status === 'disabled' && active === tabless) {
      return startManagedFallback(health);
    }
    await persist(health);
    return health;
  };

  const tick = async (): Promise<WatchHealth> => {
    if (!target) {
      const persistedStreamer = state.appState.activeStreamer;
      if (state.appState.isRunning && !state.appState.isPaused && persistedStreamer) {
        const restoredTarget = targetFor(state, persistedStreamer);
        if (restoredTarget) {
          target = restoredTarget;
          active =
            state.appState.watchTransportMode === 'tabless' &&
            state.appState.watchTransportPreference === 'tabless'
              ? tabless
              : managed;
          const restoredHealth = await active.start(restoredTarget);
          if (restoredHealth.status === 'disabled' && active === tabless) {
            return startManagedFallback(restoredHealth);
          }
          await persist(restoredHealth);
          return restoredHealth;
        }
      }
      const health = streamHealth(state.appState.currentDrop?.currentMinutes ?? null, active.mode, now());
      await persist(health);
      return health;
    }
    if (active === tabless && now() - lastTickAt < minHeartbeatIntervalMs) {
      return state.appState.watchHealth ?? streamHealth(null, active.mode, now());
    }
    lastTickAt = now();
    const health = await active.tick();
    if (active === tabless && health.shouldFallback && !fallbackIssued) {
      fallbackIssued = true;
      return startManagedFallback(health);
    }
    await persist(health);
    return health;
  };

  const stop = async () => {
    await active.stop();
    target = null;
    fallbackIssued = false;
    lastTickAt = 0;
    const health = streamHealth(null, active.mode, now());
    state.appState.watchTransportMode = health.mode;
    state.appState.watchHealth = { ...health, status: 'stopped', reason: 'stopped' };
    state.appState.watchFallbackReason = null;
    await options.persist();
    options.broadcast();
  };

  const setPreference = async (mode: WatchTransportMode) => {
    state.appState.watchTransportPreference = mode;
    await options.persist();
    options.broadcast();
  };

  return { start, tick, stop, setPreference };
}

export type { ManagedTabOpenResult, WatchProbeResult };
