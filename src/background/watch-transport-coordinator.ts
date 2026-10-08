import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { TwitchStreamer, WatchHealthSnapshot, WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { WatchStartResult } from './streamer-acquisition-contracts.ts';
import { tablessTargetKey } from './tabless-transport.ts';
import { prepareWatchCandidate } from './watch-candidate-preparation.ts';
import { hasVerifiedWatchPlayback } from './watch-health.ts';
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
import { createFarmingTarget, createInactiveWatchHealth } from './watch-transport-state.ts';
import type {
  PreparedWatch,
  WatchPreparation,
  WatchPromotion,
  WatchTransportAdoption,
  WatchTransportRuntime,
} from './watch-transport-transition.ts';

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
  readonly start: (streamer: TwitchStreamer, isCurrent?: () => boolean) => Promise<WatchStartResult>;
  readonly prepare?: (
    target: FarmingTarget,
    isCurrent?: () => boolean,
    allowInitialCreation?: boolean,
  ) => Promise<WatchPreparation>;
  readonly currentTarget?: () => FarmingTarget | null;
  readonly currentOwnership?: () => WatchOwnershipV1 | null;
  readonly probeCurrent?: () => Promise<WatchHealth | null>;
  readonly tick: (isCurrent?: () => boolean) => Promise<WatchHealth>;
  readonly stop: () => Promise<void>;
  readonly setPreference: (mode: WatchTransportMode) => Promise<void>;
}

export interface WatchTransportRuntimeCoordinator extends WatchTransportCoordinator, WatchTransportRuntime {
  readonly stop: () => Promise<void>;
  readonly currentOwnership: () => WatchOwnershipV1 | null;
  readonly prepare: (
    target: FarmingTarget,
    isCurrent?: () => boolean,
    allowInitialCreation?: boolean,
  ) => Promise<WatchPreparation>;
  readonly currentTarget: () => FarmingTarget | null;
  readonly restore: (ownership: WatchOwnershipV1) => Promise<boolean>;
}

type WatchTransportProjection =
  | { readonly kind: 'health'; readonly health: WatchHealthSnapshot }
  | { readonly kind: 'stopped'; readonly health: WatchHealthSnapshot }
  | { readonly kind: 'preference'; readonly mode: WatchTransportMode };

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
  const currentHealth = () => state.appState.watchHealth;
  const applyProjection = async (projection: WatchTransportProjection): Promise<void> => {
    const appState = state.appState;
    switch (projection.kind) {
      case 'health':
        appState.watchTransportMode = projection.health.mode;
        appState.watchHealth = projection.health;
        break;
      case 'stopped':
        appState.pendingWatchTarget = null;
        appState.watchTransportMode = projection.health.mode;
        appState.watchHealth = { ...projection.health, status: 'stopped', reason: 'stopped' };
        break;
      case 'preference':
        appState.watchTransportPreference = projection.mode;
        break;
      default:
        projection satisfies never;
    }
    await options.persist();
    options.broadcast();
  };
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
      await options.managedTab.finalizeOwnership?.(ownership);
    }
  };

  const settleHealth = async (
    health: WatchHealth,
    isCurrent: () => boolean = () => true,
  ): Promise<WatchHealth> => {
    if (isCurrent()) await applyProjection({ kind: 'health', health });
    return health;
  };

  const prepare = async (
    nextTarget: FarmingTarget,
    isCurrent: () => boolean = () => true,
    allowInitialCreation = false,
    mode: WatchTransportMode = state.appState.watchTransportPreference,
  ): Promise<WatchPreparation & { readonly health?: WatchHealth | null }> => {
    const generation = ++operationGeneration;
    const isCurrentPreparation = () => isCurrent() && generation === operationGeneration;
    const incumbentStreamer = state.appState.activeStreamer;
    const incumbentHealth = state.appState.watchHealth;
    let pending: typeof state.appState.pendingWatchTarget = null;
    const clearPending = () => {
      if (pending && state.appState.pendingWatchTarget === pending) {
        state.appState.pendingWatchTarget = null;
        options.broadcast();
        return true;
      }
      return false;
    };
    const settlePending = async (failedHealth: WatchHealth | null) => {
      if (!pending || state.appState.pendingWatchTarget !== pending) return;
      if (isCurrentPreparation() && failedHealth?.reason === 'playback-pending') {
        state.appState.watchHealth = failedHealth;
        await options.persist();
        return;
      }
      if (isCurrentPreparation()) {
        const ownership = active.currentOwnership();
        const health = ownership ? await active.tick() : null;
        if (!isCurrentPreparation()) {
          clearPending();
          return;
        }
        const selected = state.appState.selectedGame;
        const stillSelected =
          selected &&
          target &&
          (target.campaignId
            ? target.campaignId === selected.campaignId
            : (target.selectionId ?? target.gameId) === selected.id);
        if (health && hasVerifiedWatchPlayback(health) && stillSelected) {
          state.appState.activeStreamer = incumbentStreamer;
          state.appState.watchHealth = hasVerifiedWatchPlayback(incumbentHealth) ? incumbentHealth : health;
        } else {
          if (ownership) await active.stop();
          if (!isCurrentPreparation()) {
            clearPending();
            return;
          }
          state.appState.activeStreamer = ownership ? null : incumbentStreamer;
          state.appState.watchHealth = failedHealth ?? createInactiveWatchHealth(null, 'managed-tab', now());
        }
        clearPending();
        await options.persist();
      } else if (clearPending()) await options.persist();
    };
    if (active.mode === 'managed-tab' && mode === 'tabless') {
      await active.stop();
      if (!isCurrentPreparation()) return { kind: 'failed', reason: 'candidate-unavailable' };
    }
    const prepared = await prepareWatchCandidate({
      prepare: async () => {
        let opened: ManagedTabOpenResult = null;
        const transport =
          mode === 'tabless'
            ? createTabless()
            : new ManagedTabTransport({
                ...options.managedTab,
                open: async (candidateTarget, startOptions) => {
                  const game = [
                    ...state.appState.availableGames,
                    ...state.appState.queue,
                    ...(state.appState.selectedGame ? [state.appState.selectedGame] : []),
                  ].find((entry) =>
                    candidateTarget.campaignId
                      ? entry.campaignId === candidateTarget.campaignId
                      : entry.id === (candidateTarget.selectionId ?? candidateTarget.gameId),
                  );
                  if (game && isCurrentPreparation()) {
                    pending = { game, channelName: candidateTarget.channelName };
                    state.appState.pendingWatchTarget = pending;
                    state.appState.activeStreamer = null;
                    state.appState.watchHealth = null;
                    await options.persist();
                    if (!isCurrentPreparation()) return null;
                    options.broadcast();
                  }
                  opened = await options.managedTab.open(candidateTarget, {
                    ...startOptions,
                    allowInitialCreation,
                  });
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
        health.isHealthy || (health.status === 'degraded' && health.reason === 'user-interaction-required'),
    });
    if (prepared.kind === 'failed') {
      await settlePending(prepared.health);
      return { kind: 'failed', reason: 'candidate-unavailable', health: prepared.health };
    }
    const candidate = prepared.candidate;
    const ownership = candidate.transport.currentOwnership();
    if (!ownership) {
      await candidate.dispose();
      await settlePending(null);
      return { kind: 'failed', reason: 'candidate-unavailable', health: candidate.health };
    }
    let promotion: WatchPromotion | null = null;
    let disposal: Promise<void> | null = null;
    let discarded = false;
    const watch: PreparedWatch = {
      target: nextTarget,
      ownership,
      health: candidate.health,
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
        lastTickAt = 0;
        if (state.appState.pendingWatchTarget === pending) state.appState.pendingWatchTarget = null;
        promotion = { kind: 'promoted', ownership, obsolete };
        void previous.stop().catch(() => undefined);
        void finalizeManagedPromotion(ownership, obsolete).catch(() => undefined);
        return promotion;
      },
      dispose: () => {
        if (promotion) return Promise.resolve();
        discarded = true;
        disposal ??= Promise.resolve()
          .then(candidate.dispose)
          .then(() => settlePending(null));
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
      () => isCurrent() && generation === operationGeneration,
    );
    return isCurrent() && generation === operationGeneration
      ? { kind: 'started', health }
      : { kind: 'cancelled' };
  };

  const tick = async (isCurrent: () => boolean = () => true): Promise<WatchHealth> => {
    const generation = operationGeneration;
    const isCurrentTick = () => isCurrent() && generation === operationGeneration;
    if (!isCurrentTick()) return currentHealth() ?? createInactiveWatchHealth(null, active.mode, now());
    if (!target) {
      const persistedStreamer = state.appState.activeStreamer;
      if (state.appState.isRunning && !state.appState.isPaused && persistedStreamer) {
        const started = await start(persistedStreamer, isCurrent);
        return started.kind === 'cancelled'
          ? (currentHealth() ?? createInactiveWatchHealth(null, active.mode, now()))
          : (started.health ?? createInactiveWatchHealth(null, active.mode, now()));
      }
      const health = createInactiveWatchHealth(
        state.appState.currentDrop?.currentMinutes ?? null,
        active.mode,
        now(),
      );
      await applyProjection({ kind: 'health', health });
      return health;
    }
    if (active.mode === 'tabless' && now() - lastTickAt < minHeartbeatIntervalMs) {
      return currentHealth() ?? createInactiveWatchHealth(null, active.mode, now());
    }
    lastTickAt = now();
    const health = await active.tick();
    return settleHealth(health, isCurrentTick);
  };

  const stop = async () => {
    const generation = ++operationGeneration;
    const tick = state.tickGeneration;
    const isCurrent = () => generation === operationGeneration && state.tickGeneration === tick;
    await active.stop();
    if (!isCurrent()) return;
    await options.managedTab.pauseRetained?.(isCurrent);
    if (!isCurrent()) return;
    target = null;
    lastTickAt = 0;
    const health = createInactiveWatchHealth(null, active.mode, now());
    await applyProjection({ kind: 'stopped', health });
  };

  const setPreference = async (mode: WatchTransportMode) => {
    await applyProjection({ kind: 'preference', mode });
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
    lastTickAt = 0;
    const previousOwnership = previous.currentOwnership();
    const sameManagedWatch =
      previousOwnership?.kind === 'managed-tab' &&
      adoption.ownership.kind === 'managed-tab' &&
      previousOwnership.tabId === adoption.ownership.tabId &&
      previousOwnership.ownershipToken === adoption.ownership.ownershipToken;
    if (adoption.obsolete === null && previousOwnership !== null && !sameManagedWatch) {
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
    if (ownership.kind === 'managed-tab') {
      operationGeneration += 1;
      const retained = createManaged();
      retained.adopt(
        { gameId: '', channelName: ownership.expectedChannel },
        ownership,
        createInactiveWatchHealth(null, 'managed-tab', now()),
      );
      active = retained;
      target = null;
      lastTickAt = 0;
    }
    if (!state.appState.isRunning || state.appState.isPaused) {
      if (ownership.kind === 'managed-tab') await active.stop();
      return ownership.kind === 'managed-tab';
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
      if (!hasVerifiedWatchPlayback(checked) && !waitingForInteraction) return false;
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
    await applyProjection({ kind: 'health', health });
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
    probeCurrent: async () => {
      const generation = operationGeneration;
      const health = await active.tick();
      return generation === operationGeneration ? health : null;
    },
    hasViableManagedWatch: () =>
      target !== null &&
      active.mode === 'managed-tab' &&
      hasVerifiedWatchPlayback(state.appState.watchHealth) &&
      state.appState.currentDrop !== null &&
      isRewardFarmableNow(state.appState.currentDrop),
    currentTarget: () => target,
  };
}

export type { ManagedTabOpenResult, WatchProbeResult };
