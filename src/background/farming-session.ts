import type { FarmingSessionAdapters, RefreshDropsOptions } from './farming-session-context.ts';
import { createFarmingSessionContext } from './farming-session-context.ts';
import { createFarmingSessionHandlers, type FarmingSessionStopOptions } from './farming-session-handlers.ts';
import { createFarmingSessionMonitoring } from './farming-session-monitoring.ts';
import { createFarmingSessionQueue } from './farming-session-queue.ts';
import { createFarmingSessionStreaming } from './farming-session-streaming.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type {
  FarmingSessionAdapters,
  RefreshDropsOptions,
  StreamContext,
} from './farming-session-context.ts';

export function createFarmingSession(state: ServiceWorkerState, adapters: FarmingSessionAdapters) {
  const context = createFarmingSessionContext(state, adapters);
  const streaming = createFarmingSessionStreaming(context, {
    onRefreshDropsData: refreshDropsData,
    onStopFarmingSession: stop,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
  });
  const {
    acquireStreamerForSelectedGame,
    ensureWorkspaceForSelectedGame,
    handleRecoverySkip,
    recoverStalledProgress,
    rotateStreamerIfInvalid,
  } = streaming;
  const monitoring = createFarmingSessionMonitoring(context, {
    onRotateStreamerIfInvalid: rotateStreamerIfInvalid,
    onAcquireStreamerForSelectedGame: acquireStreamerForSelectedGame,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onHandleRecoverySkip: handleRecoverySkip,
    onRecoverStalledProgress: recoverStalledProgress,
  });
  const { checkDropProgress, startMonitoring, stopMonitoring } = monitoring;
  const queue = createFarmingSessionQueue(context, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onAcquireStreamer: acquireStreamerForSelectedGame,
    onStopMonitoring: stopMonitoring,
  });
  const {
    handleAddToQueue,
    handleClearQueue,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleSetSelectedGame,
  } = queue;
  const handlers = createFarmingSessionHandlers(context, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onAcquireStreamer: acquireStreamerForSelectedGame,
    onStartMonitoring: startMonitoring,
    onStopMonitoring: stopMonitoring,
  });
  const {
    handlePauseFarming,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    resumeAfterAuthRecovery,
  } = handlers;

  function refreshDropsData(options: RefreshDropsOptions = {}): Promise<void> {
    return monitoring.refreshDropsData(options);
  }

  function stop(options?: FarmingSessionStopOptions): Promise<void> {
    return handlers.stop(options);
  }

  function advanceQueueIfCompleted(): Promise<boolean> {
    return queue.advanceQueueIfCompleted();
  }

  return {
    acquireStreamerForSelectedGame,
    checkDropProgress,
    handleAddToQueue,
    handleClearQueue,
    handlePauseFarming,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleResumeFarming,
    handleSetSelectedGame,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    refreshDropsData,
    resumeAfterAuthRecovery,
    startMonitoring,
    stop,
    stopMonitoring,
  };
}
