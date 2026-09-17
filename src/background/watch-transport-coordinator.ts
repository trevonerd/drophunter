import type { TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { prepareWatchCandidate } from './watch-candidate-preparation.ts';
import { createWatchFallbackPolicy } from './watch-fallback-policy.ts';
import {
  type FarmingTarget,
  type ManagedTabOpenResult,
  ManagedTabTransport,
  TablessTransport,
  type WatchHealth,
  type WatchProbeResult,
  type WatchTransport,
} from './watch-transport.ts';
import type {
  WatchTransportCoordinatorOptions,
  WatchTransportRuntimeCoordinator,
} from './watch-transport-coordinator-contracts.ts';
import {
  createWatchTransportProjectionStore,
  type WatchTransportProjection,
} from './watch-transport-projection.ts';
import { createFarmingTarget, createInactiveWatchHealth } from './watch-transport-state.ts';
import type { WatchTransportAdoption } from './watch-transport-transition.ts';

export function createWatchTransportCoordinator(
  options: WatchTransportCoordinatorOptions,
): WatchTransportRuntimeCoordinator {
  const state = options.state;
  const now = options.now ?? Date.now;
  const minHeartbeatIntervalMs = Math.max(1_000, options.minHeartbeatIntervalMs ?? 55_000);
  const createTabless = (): WatchTransport =>
    new TablessTransport({
      enabled: options.enabled ?? true,
      heartbeat: options.heartbeat,
      now,
    });
  const createManaged = (): WatchTransport => new ManagedTabTransport({ ...options.managedTab, now });
  const projection = createWatchTransportProjectionStore(options);
  const fallbackPolicy = createWatchFallbackPolicy();
  let active: WatchTransport = createManaged();
  let target: FarmingTarget | null = null;
  let lastTickAt = 0;
  let operationGeneration = 0;

  const startManagedFallback = async (
    fallbackHealth: WatchHealth,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchHealth> => {
    if (!isCurrent()) return fallbackHealth;
    const nextTarget = target;
    if (!nextTarget) {
      if (!isCurrent()) return fallbackHealth;
      await projection.apply({ kind: 'checked', health: fallbackHealth });
      return fallbackHealth;
    }
    const previous = active;
    const prepared = await prepareWatchCandidate({
      prepare: async () => {
        const transport = createManaged();
        return {
          transport,
          health: await transport.start(nextTarget),
          dispose: () => transport.stop(),
        };
      },
      isCurrent,
    });
    if (prepared.kind === 'failed') {
      if (!isCurrent()) return prepared.health ?? fallbackHealth;
      await projection.apply({ kind: 'checked', health: fallbackHealth });
      return fallbackHealth;
    }
    const { health, transport: candidate } = prepared.candidate;
    active = candidate;
    await previous.stop();
    if (!isCurrent()) return health;
    await projection.apply({
      kind: 'fallback',
      health,
      reason: fallbackHealth.reason,
    });
    return health;
  };

  const settleHealth = async (
    health: WatchHealth,
    projectionKind: Extract<WatchTransportProjection['kind'], 'started' | 'checked'>,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchHealth> => {
    if (!isCurrent()) return health;
    if (state.appState.watchTransportPreference === 'tabless') {
      await projection.apply({ kind: projectionKind, health });
      return health;
    }
    if (projectionKind === 'started' && health.mode === 'tabless' && !health.isHealthy) {
      return startManagedFallback(health, isCurrent);
    }
    const decision = fallbackPolicy.evaluate(health);
    switch (decision.kind) {
      case 'continue':
        if (!isCurrent()) return health;
        await projection.apply({ kind: projectionKind, health });
        return health;
      case 'fallback':
        return startManagedFallback(health, isCurrent);
      default:
        decision satisfies never;
        return health;
    }
  };

  const start = async (
    streamer: TwitchStreamer,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchHealth> => {
    const generation = ++operationGeneration;
    const isCurrentStart = () => isCurrent() && generation === operationGeneration;
    const nextTarget = createFarmingTarget(state, streamer);
    if (!nextTarget) {
      const health = createInactiveWatchHealth(
        state.appState.currentDrop?.currentMinutes ?? null,
        'managed-tab',
        now(),
      );
      if (!isCurrentStart()) return health;
      await projection.apply({ kind: 'started', health });
      return health;
    }
    const previous = active;
    const previousHealth =
      target === null
        ? null
        : (projection.currentHealth() ??
          (previous.currentOwnership()
            ? createInactiveWatchHealth(
                state.appState.currentDrop?.currentMinutes ?? null,
                previous.mode,
                now(),
              )
            : null));
    const prepared = await prepareWatchCandidate({
      prepare: async () => {
        const transport =
          state.appState.watchTransportPreference === 'tabless' ? createTabless() : createManaged();
        return {
          transport,
          health: await transport.start(nextTarget),
          dispose: () => transport.stop(),
        };
      },
      isCurrent: isCurrentStart,
      accept: (health) => previousHealth === null || health.isHealthy,
    });
    if (prepared.kind === 'failed') {
      return previousHealth ?? prepared.health ?? createInactiveWatchHealth(null, previous.mode, now());
    }
    const { health, transport: candidate } = prepared.candidate;
    target = nextTarget;
    active = candidate;
    fallbackPolicy.reset();
    lastTickAt = 0;
    state.appState.activeStreamer = { ...streamer, isLive: true };
    if (candidate.mode === 'tabless') state.appState.tabId = null;
    if (previousHealth) await previous.stop();
    if (!isCurrentStart()) return health;
    return settleHealth(health, 'started', isCurrentStart);
  };

  const tick = async (isCurrent: () => boolean = () => true): Promise<WatchHealth> => {
    const generation = operationGeneration;
    const isCurrentTick = () => isCurrent() && generation === operationGeneration;
    if (!isCurrentTick())
      return projection.currentHealth() ?? createInactiveWatchHealth(null, active.mode, now());
    if (!target) {
      const persistedStreamer = state.appState.activeStreamer;
      if (state.appState.isRunning && !state.appState.isPaused && persistedStreamer) {
        return start(persistedStreamer, isCurrent);
      }
      const health = createInactiveWatchHealth(
        state.appState.currentDrop?.currentMinutes ?? null,
        active.mode,
        now(),
      );
      await projection.apply({ kind: 'checked', health });
      return health;
    }
    if (active.mode === 'tabless' && now() - lastTickAt < minHeartbeatIntervalMs) {
      return projection.currentHealth() ?? createInactiveWatchHealth(null, active.mode, now());
    }
    lastTickAt = now();
    const health = await active.tick();
    return settleHealth(health, 'checked', isCurrentTick);
  };

  const stop = async () => {
    const generation = ++operationGeneration;
    await active.stop();
    if (generation !== operationGeneration) return;
    target = null;
    fallbackPolicy.reset();
    lastTickAt = 0;
    const health = createInactiveWatchHealth(null, active.mode, now());
    await projection.apply({ kind: 'stopped', health });
  };

  const setPreference = async (mode: WatchTransportMode) => {
    await projection.apply({ kind: 'preference', mode });
  };

  const adopt = (adoption: WatchTransportAdoption): void => {
    operationGeneration += 1;
    const previous = active;
    const next = adoption.ownership.kind === 'tabless' ? createTabless() : createManaged();
    if (!next.adopt(adoption.target, adoption.ownership, adoption.health)) {
      throw new DOMException('Watch transport adoption mode mismatch', 'InvariantError');
    }
    active = next;
    target = adoption.target;
    fallbackPolicy.reset();
    lastTickAt = 0;
    if (adoption.obsolete === null && previous.currentOwnership() !== null) {
      void previous.stop().catch(() => undefined);
    }
  };

  const restore = async (ownership: WatchOwnershipV1): Promise<boolean> => {
    const streamer = state.appState.activeStreamer;
    if (!streamer) return false;
    const restoredTarget = createFarmingTarget(state, streamer);
    if (!restoredTarget) return false;
    const persistedHealth = state.appState.watchHealth;
    const health =
      persistedHealth?.mode === ownership.kind
        ? persistedHealth
        : createInactiveWatchHealth(
            state.appState.currentDrop?.currentMinutes ?? null,
            ownership.kind,
            now(),
          );
    adopt({ target: restoredTarget, ownership, health, obsolete: null });
    if (ownership.kind === 'managed-tab' && state.appState.watchTransportPreference === 'tabless') {
      const restartedHealth = await start(streamer);
      return restartedHealth.mode === 'tabless';
    }
    await projection.apply({ kind: 'started', health });
    return true;
  };

  return {
    start,
    tick,
    stop,
    setPreference,
    adopt,
    restore,
    currentOwnership: () => active.currentOwnership(),
  };
}

export type * from './watch-transport-coordinator-contracts.ts';
export type { ManagedTabOpenResult, WatchProbeResult };
