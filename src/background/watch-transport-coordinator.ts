import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { rememberManagedWatch } from './managed-watch-registry.ts';
import type { WatchStartResult } from './streamer-acquisition-contracts.ts';
import { streamerWatchUrl } from './tab-management.ts';
import { tablessTargetKey } from './tabless-transport.ts';
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
import type {
  PreparedWatch,
  WatchPreparation,
  WatchPromotion,
  WatchTransportAdoption,
} from './watch-transport-transition.ts';

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

  const finalizeManagedPromotion = async (ownership: WatchOwnershipV1, obsolete: WatchOwnershipV1 | null) => {
    if (ownership.kind !== 'managed-tab') return;
    if (obsolete?.kind === 'managed-tab' && obsolete.tabId !== ownership.tabId) {
      await options.managedTab.close({ owner: 'drophunter', tabId: obsolete.tabId, ownership: obsolete });
    }
    const currentOwnership = active.currentOwnership();
    if (
      currentOwnership?.kind === 'managed-tab' &&
      currentOwnership.ownershipToken === ownership.ownershipToken
    ) {
      await rememberManagedWatch(
        ownership.tabId,
        ownership.ownershipToken,
        streamerWatchUrl(ownership.expectedChannel),
      );
    }
  };

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
        let opened: ManagedTabOpenResult = null;
        const transport = new ManagedTabTransport({
          ...options.managedTab,
          open: async (candidateTarget, startOptions) => {
            opened = await options.managedTab.open(candidateTarget, startOptions);
            return opened;
          },
          now,
        });
        return {
          transport,
          health: await transport.start(nextTarget, isCurrent),
          dispose: async () => {
            await transport.stop();
            if (opened?.owner === 'drophunter') await opened.dispose?.();
          },
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

  const prepare = async (
    nextTarget: FarmingTarget,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchPreparation & { readonly health?: WatchHealth | null }> => {
    const generation = ++operationGeneration;
    const isCurrentPreparation = () => isCurrent() && generation === operationGeneration;
    const prepared = await prepareWatchCandidate({
      prepare: async () => {
        let opened: ManagedTabOpenResult = null;
        const transport =
          state.appState.watchTransportPreference === 'tabless'
            ? createTabless()
            : new ManagedTabTransport({
                ...options.managedTab,
                open: async (candidateTarget, startOptions) => {
                  opened = await options.managedTab.open(candidateTarget, startOptions);
                  return opened;
                },
                now,
              });
        return {
          transport,
          health: await transport.start(nextTarget, isCurrentPreparation),
          dispose: async () => {
            await transport.stop();
            if (opened?.owner === 'drophunter') await opened.dispose?.();
          },
        };
      },
      isCurrent: isCurrentPreparation,
      accept: (health) =>
        health.isHealthy ||
        (health.status === 'degraded' &&
          health.reason === 'user-interaction-required' &&
          (target === null ||
            (state.appState.currentDrop === null &&
              state.appState.allDrops.length > 0 &&
              !state.appState.allDrops.some((drop) => isRewardFarmableNow(drop, now())) &&
              !state.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop, now()))))),
    });
    if (prepared.kind === 'failed') {
      return { kind: 'failed', reason: 'candidate-unavailable', health: prepared.health };
    }
    const candidate = prepared.candidate;
    const ownership = candidate.transport.currentOwnership();
    if (!ownership) {
      await candidate.dispose();
      return { kind: 'failed', reason: 'candidate-unavailable', health: candidate.health };
    }
    let promotion: WatchPromotion | null = null;
    let disposal: Promise<void> | null = null;
    let discarded = false;
    const watch: PreparedWatch = {
      target: nextTarget,
      ownership,
      health: candidate.health,
      fallbackReason: null,
      promote: () => {
        if (promotion) return promotion;
        if (discarded || !isCurrentPreparation()) {
          void watch.dispose().catch(() => undefined);
          return { kind: 'discarded', ownership };
        }
        const previous = active;
        const obsolete = previous.currentOwnership();
        target = nextTarget;
        active = candidate.transport;
        fallbackPolicy.reset();
        lastTickAt = 0;
        promotion = { kind: 'promoted', ownership, obsolete };
        void previous.stop().catch(() => undefined);
        void finalizeManagedPromotion(ownership, obsolete).catch(() => undefined);
        return promotion;
      },
      dispose: () => {
        if (promotion) return Promise.resolve();
        discarded = true;
        disposal ??= Promise.resolve().then(candidate.dispose);
        return disposal;
      },
    };
    return { kind: 'prepared', watch };
  };

  const start = async (
    streamer: TwitchStreamer,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchStartResult> => {
    if (!isCurrent()) return { kind: 'cancelled' };
    const nextTarget = createFarmingTarget(state, streamer);
    if (!nextTarget) return { kind: 'failed', health: null };
    const generation = operationGeneration + 1;
    const prepared = await prepare(nextTarget, isCurrent);
    if (!isCurrent() || generation !== operationGeneration) {
      if (prepared.kind === 'prepared') await prepared.watch.dispose();
      return { kind: 'cancelled' };
    }
    if (prepared.kind === 'failed') return { kind: 'failed', health: prepared.health ?? null };
    if (prepared.watch.promote().kind === 'discarded') return { kind: 'cancelled' };
    state.appState.activeStreamer = { ...streamer, isLive: true };
    state.appState.tabId =
      prepared.watch.ownership.kind === 'managed-tab' ? prepared.watch.ownership.tabId : null;
    const health = await settleHealth(
      prepared.watch.health,
      'started',
      () => isCurrent() && generation === operationGeneration,
    );
    return isCurrent() && generation === operationGeneration
      ? { kind: 'started', health }
      : { kind: 'cancelled' };
  };

  const tick = async (isCurrent: () => boolean = () => true): Promise<WatchHealth> => {
    const generation = operationGeneration;
    const isCurrentTick = () => isCurrent() && generation === operationGeneration;
    if (!isCurrentTick())
      return projection.currentHealth() ?? createInactiveWatchHealth(null, active.mode, now());
    if (!target) {
      const persistedStreamer = state.appState.activeStreamer;
      if (state.appState.isRunning && !state.appState.isPaused && persistedStreamer) {
        const started = await start(persistedStreamer, isCurrent);
        return started.kind === 'cancelled'
          ? (projection.currentHealth() ?? createInactiveWatchHealth(null, active.mode, now()))
          : (started.health ?? createInactiveWatchHealth(null, active.mode, now()));
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
    if (
      adoption.obsolete === null ||
      (adoption.obsolete.kind === 'managed-tab' &&
        adoption.ownership.kind === 'managed-tab' &&
        adoption.obsolete.tabId === adoption.ownership.tabId)
    ) {
      void finalizeManagedPromotion(adoption.ownership, null).catch(() => undefined);
    }
  };

  const restore = async (ownership: WatchOwnershipV1): Promise<boolean> => {
    if (!state.appState.isRunning || state.appState.isPaused) {
      if (ownership.kind !== 'managed-tab') return false;
      operationGeneration += 1;
      const retained = createManaged();
      retained.adopt(
        { gameId: '', channelName: ownership.expectedChannel },
        ownership,
        createInactiveWatchHealth(null, 'managed-tab', now()),
      );
      active = retained;
      target = null;
      fallbackPolicy.reset();
      lastTickAt = 0;
      return true;
    }
    const streamer = state.appState.activeStreamer;
    if (!streamer) return false;
    if (
      ownership.kind === 'managed-tab' &&
      streamer.name.trim().toLowerCase() !== ownership.expectedChannel.trim().toLowerCase()
    )
      return false;
    const restoredTarget = createFarmingTarget(state, streamer);
    if (!restoredTarget) return false;
    if (ownership.kind === 'tabless' && ownership.targetKey !== tablessTargetKey(restoredTarget))
      return false;
    const persistedHealth = state.appState.watchHealth;
    let health =
      persistedHealth?.mode === ownership.kind
        ? persistedHealth
        : createInactiveWatchHealth(
            state.appState.currentDrop?.currentMinutes ?? null,
            ownership.kind,
            now(),
          );
    if (ownership.kind === 'managed-tab') {
      const generation = ++operationGeneration;
      const candidate = createManaged();
      candidate.adopt(restoredTarget, ownership, health);
      const checked = await candidate.tick();
      await candidate.stop();
      if (
        generation !== operationGeneration ||
        !state.appState.isRunning ||
        state.appState.isPaused ||
        state.appState.activeStreamer?.name !== streamer.name ||
        state.appState.selectedGame?.campaignId !== restoredTarget.campaignId ||
        state.appState.selectedGame?.id !== restoredTarget.selectionId
      )
        return false;
      const waitingForInteraction =
        persistedHealth?.reason === 'user-interaction-required' &&
        (checked.reason === 'playback-inactive' || checked.reason === 'user-interaction-required');
      if (!checked.isHealthy && !waitingForInteraction) return false;
      if (!waitingForInteraction) health = checked;
    }
    adopt({ target: restoredTarget, ownership, health, obsolete: null });
    if (state.appState.isRunning || state.appState.isPaused) {
      state.appState.tabId = ownership.kind === 'managed-tab' ? ownership.tabId : null;
    }
    if (ownership.kind === 'managed-tab' && state.appState.watchTransportPreference === 'tabless') {
      const restarted = await start(streamer);
      return restarted.kind === 'started' && restarted.health?.mode === 'tabless';
    }
    await projection.apply({ kind: 'started', health });
    return true;
  };

  return {
    start,
    prepare,
    tick,
    stop,
    setPreference,
    adopt,
    restore,
    currentOwnership: () => active.currentOwnership(),
    hasViableManagedWatch: () =>
      target !== null &&
      active.mode === 'managed-tab' &&
      state.appState.watchHealth?.isHealthy === true &&
      state.appState.currentDrop !== null &&
      isRewardFarmableNow(state.appState.currentDrop),
    currentTarget: () => target,
  };
}

export type * from './watch-transport-coordinator-contracts.ts';
export type { ManagedTabOpenResult, WatchProbeResult };
