import { gameKey } from '../shared/game-selection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { captureCampaignGuard } from './farming-session-revision.ts';
import { applyRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { computeEffectiveStallThreshold, STALLED_PROGRESS_RETRY_MS } from './stream-rotation.ts';
import { MAX_STREAMER_ATTEMPTS, watchObservationStartedAt } from './streamer-watch-attempt.ts';

export type StalledProgressSource =
  | { readonly kind: 'managed-tab'; readonly tabId: number }
  | { readonly kind: 'tabless' };

export type StalledProgressRecoveryResult =
  | { readonly kind: 'recovered' }
  | { readonly kind: 'refresh-unavailable' }
  | {
      readonly kind: 'retry-scheduled';
      readonly attempt: number;
      readonly retryAt: number;
      readonly started: boolean;
    }
  | { readonly kind: 'selection-changed' }
  | { readonly kind: 'auth-required' };

export interface StalledProgressRecoveryDependencies {
  readonly isCurrent?: () => boolean;
  readonly now: () => number;
  readonly onCampaignRefresh: (isCurrent?: () => boolean) => Promise<RefreshDropsOutcome>;
  readonly onInventoryRefresh: (isCurrent?: () => boolean) => Promise<RefreshDropsOutcome>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onRotateStreamer: (isCurrent?: () => boolean) => Promise<boolean> | Promise<void>;
  readonly onSkipCurrentGame: (
    verifiedAlternativesExhausted?: boolean,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  readonly onSaveState: () => Promise<void>;
  readonly onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

export async function recoverStalledProgress(
  state: ServiceWorkerState,
  _source: StalledProgressSource,
  dependencies: StalledProgressRecoveryDependencies,
): Promise<StalledProgressRecoveryResult> {
  const now = dependencies.now();
  const campaignCurrent = captureCampaignGuard(state, dependencies.isCurrent);
  const isCurrent = () => campaignCurrent() && state.appState.isRunning && !state.appState.isPaused;
  if (!isCurrent()) return { kind: 'selection-changed' };
  const recoveryAlreadyActive = state.appState.recoveryReason === 'stalled-progress';

  if (recoveryAlreadyActive && state.recoveryBackoffUntil > now) {
    return {
      kind: 'retry-scheduled',
      attempt: state.stalledRecoveryAttempts,
      retryAt: state.recoveryBackoffUntil,
      started: false,
    };
  }

  const stallWindow = computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);
  const observedAt = watchObservationStartedAt(state);
  if (observedAt > 0 && now - observedAt < stallWindow) {
    const retryAt = observedAt + stallWindow;
    if (
      recoveryAlreadyActive &&
      (state.recoveryBackoffUntil !== retryAt || state.appState.recoveryBackoffUntil !== retryAt)
    ) {
      state.recoveryBackoffUntil = retryAt;
      state.lastRecoveryAttemptAt = now;
      applyRecoveryState(state, 'stalled-progress', retryAt);
      await dependencies.onSaveState();
      if (!isCurrent()) return { kind: 'selection-changed' };
      await dependencies.onSaveTimingState(state);
      if (!isCurrent()) return { kind: 'selection-changed' };
    }
    return {
      kind: 'retry-scheduled',
      attempt: state.stalledRecoveryAttempts,
      retryAt,
      started: false,
    };
  }

  const previousDrop = state.appState.currentDrop;
  const campaignRefresh = await dependencies.onCampaignRefresh(isCurrent);
  if (!isCurrent()) return { kind: 'selection-changed' };
  if (campaignRefresh === 'auth-required') return { kind: 'auth-required' };
  if (campaignRefresh !== 'refreshed') return { kind: 'refresh-unavailable' };
  await dependencies.onAdvanceQueueIfCompleted();
  if (!isCurrent()) {
    return { kind: 'selection-changed' };
  }
  // No observable watch-time reward remains. Keep its authorized target unresolved,
  // but let the rest of the queue proceed instead of watching forever.
  if (state.appState.currentDrop === null) {
    await dependencies.onSkipCurrentGame(false, isCurrent);
    return { kind: 'selection-changed' };
  }
  const inventoryRefresh = await dependencies.onInventoryRefresh(isCurrent);
  if (!isCurrent()) return { kind: 'selection-changed' };
  if (inventoryRefresh === 'auth-required') return { kind: 'auth-required' };
  if (inventoryRefresh !== 'refreshed') return { kind: 'refresh-unavailable' };
  await dependencies.onAdvanceQueueIfCompleted();
  if (!isCurrent()) {
    return { kind: 'selection-changed' };
  }

  const currentDrop = state.appState.currentDrop;
  const progressResumed =
    previousDrop !== null &&
    currentDrop !== null &&
    currentDrop.id === previousDrop.id &&
    currentDrop.campaignId === previousDrop.campaignId &&
    (currentDrop.progress > previousDrop.progress ||
      (currentDrop.currentMinutes ?? -1) > (previousDrop.currentMinutes ?? -1));
  const recoveryCleared = recoveryAlreadyActive && state.appState.recoveryReason !== 'stalled-progress';
  if (progressResumed || recoveryCleared) {
    return { kind: 'recovered' };
  }

  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) return { kind: 'selection-changed' };
  const selectedKey = gameKey(selectedGame);
  const metadata = state.appState.queueEntryMetadataByKey[selectedKey] ?? {
    source:
      state.appState.farmingSessionOrigin === 'automatic' ? ('favorite-auto' as const) : ('manual' as const),
    addedAt: now,
    reason:
      state.appState.farmingSessionOrigin === 'automatic'
        ? ('favorite-discovered' as const)
        : ('user-added' as const),
  };
  const attemptedStreamerNames = [
    ...new Set(
      (metadata.attemptedStreamerNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  const activeName = state.appState.activeStreamer?.name.trim().toLowerCase();
  if (activeName && !attemptedStreamerNames.includes(activeName)) attemptedStreamerNames.push(activeName);
  state.appState.queueEntryMetadataByKey[selectedKey] = {
    ...metadata,
    attemptedStreamerNames: attemptedStreamerNames.slice(0, MAX_STREAMER_ATTEMPTS),
  };
  if (attemptedStreamerNames.length >= MAX_STREAMER_ATTEMPTS) {
    await dependencies.onSkipCurrentGame(false, isCurrent);
    return { kind: 'selection-changed' };
  }

  const attempt = attemptedStreamerNames.length;
  let retryAt = now + STALLED_PROGRESS_RETRY_MS;
  state.stalledRecoveryAttempts = attempt;
  state.lastRecoveryAttemptAt = now;
  state.recoveryBackoffUntil = retryAt;
  state.invalidStreamChecks = 0;
  applyRecoveryState(state, 'stalled-progress', retryAt);

  {
    state.recoveryBackoffUntil = 0;
    const opened = await dependencies.onRotateStreamer(isCurrent);
    if (!isCurrent()) return { kind: 'selection-changed' };
    if (opened === false && state.appState.recoveryReason !== 'stalled-progress') {
      const retryAt =
        state.appState.recoveryBackoffUntil || state.recoveryBackoffUntil || now + STALLED_PROGRESS_RETRY_MS;
      return { kind: 'retry-scheduled', attempt, retryAt, started: false };
    }
    if (opened !== false && watchObservationStartedAt(state) > 0) {
      retryAt = watchObservationStartedAt(state) + stallWindow;
    }
  }

  if (!isCurrent()) {
    return { kind: 'selection-changed' };
  }
  state.recoveryBackoffUntil = retryAt;
  applyRecoveryState(state, 'stalled-progress', retryAt);
  await dependencies.onSaveState();
  if (!isCurrent()) return { kind: 'selection-changed' };
  await dependencies.onSaveTimingState(state);
  if (!isCurrent()) return { kind: 'selection-changed' };
  return { kind: 'retry-scheduled', attempt, retryAt, started: true };
}
