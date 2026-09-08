import { gameKey } from '../shared/game-selection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { applyRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS, STALLED_PROGRESS_RETRY_MS } from './stream-rotation.ts';

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
  readonly onAttemptPlaybackSelfHeal: (tabId: number, isCurrent?: () => boolean) => Promise<void>;
  readonly onRestartTablessWatcher: (isCurrent?: () => boolean) => Promise<void>;
  readonly onRotateManagedStreamer: (isCurrent?: () => boolean) => Promise<void>;
  readonly onSkipCurrentGame: () => Promise<void>;
  readonly onSaveState: () => Promise<void>;
  readonly onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

function selectedCampaignKey(state: ServiceWorkerState): string | null {
  return state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
}

export async function recoverStalledProgress(
  state: ServiceWorkerState,
  source: StalledProgressSource,
  dependencies: StalledProgressRecoveryDependencies,
): Promise<StalledProgressRecoveryResult> {
  const now = dependencies.now();
  const previousKey = selectedCampaignKey(state);
  const epoch = currentFarmingSessionEpoch(state);
  const generation = state.tickGeneration;
  const isCurrent = () =>
    dependencies.isCurrent?.() !== false &&
    currentFarmingSessionEpoch(state) === epoch &&
    state.tickGeneration === generation &&
    state.appState.isRunning &&
    !state.appState.isPaused &&
    selectedCampaignKey(state) === previousKey;
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

  const previousDrop = state.appState.currentDrop;
  const campaignRefresh = await dependencies.onCampaignRefresh(isCurrent);
  if (!isCurrent()) return { kind: 'selection-changed' };
  if (campaignRefresh === 'auth-required') return { kind: 'auth-required' };
  if (campaignRefresh !== 'refreshed') return { kind: 'refresh-unavailable' };
  await dependencies.onAdvanceQueueIfCompleted();
  if (!isCurrent()) {
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
    (currentDrop.id !== previousDrop.id ||
      currentDrop.progress > previousDrop.progress ||
      (currentDrop.currentMinutes ?? -1) > (previousDrop.currentMinutes ?? -1));
  const recoveryCleared = recoveryAlreadyActive && state.appState.recoveryReason !== 'stalled-progress';
  if (progressResumed || recoveryCleared || currentDrop === null) {
    return { kind: 'recovered' };
  }

  if (state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS) {
    await dependencies.onSkipCurrentGame();
    return { kind: 'selection-changed' };
  }

  const attempt = state.stalledRecoveryAttempts + 1;
  const retryAt = now + STALLED_PROGRESS_RETRY_MS;
  state.stalledRecoveryAttempts = attempt;
  state.lastRecoveryAttemptAt = now;
  state.recoveryBackoffUntil = retryAt;
  state.invalidStreamChecks = 0;
  applyRecoveryState(state, 'stalled-progress', retryAt);

  if (source.kind === 'tabless') {
    await dependencies.onRestartTablessWatcher(isCurrent);
  } else if (attempt === 1) {
    await dependencies.onAttemptPlaybackSelfHeal(source.tabId, isCurrent);
  } else {
    await dependencies.onRotateManagedStreamer(isCurrent);
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
