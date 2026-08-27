import { gameKey } from '../shared/game-selection.ts';
import { applyRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS, STALLED_PROGRESS_RETRY_MS } from './stream-rotation.ts';

export type StalledProgressSource =
  | { readonly kind: 'managed-tab'; readonly tabId: number }
  | { readonly kind: 'tabless' };

export type StalledProgressRecoveryResult =
  | { readonly kind: 'recovered' }
  | {
      readonly kind: 'retry-scheduled';
      readonly attempt: number;
      readonly retryAt: number;
      readonly started: boolean;
    }
  | { readonly kind: 'selection-changed' };

export interface StalledProgressRecoveryDependencies {
  readonly now: () => number;
  readonly onCampaignRefresh: () => Promise<void>;
  readonly onInventoryRefresh: () => Promise<void>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onAttemptPlaybackSelfHeal: (tabId: number) => Promise<void>;
  readonly onRestartTablessWatcher: () => Promise<void>;
  readonly onRotateManagedStreamer: () => Promise<void>;
  readonly onSkipCurrentGame: () => Promise<void>;
  readonly onSaveState: () => Promise<void>;
  readonly onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

function selectedCampaignKey(state: ServiceWorkerState): string | null {
  return state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
}

function selectionChanged(state: ServiceWorkerState, previousKey: string | null): boolean {
  return !state.appState.isRunning || selectedCampaignKey(state) !== previousKey;
}

export async function recoverStalledProgress(
  state: ServiceWorkerState,
  source: StalledProgressSource,
  dependencies: StalledProgressRecoveryDependencies,
): Promise<StalledProgressRecoveryResult> {
  const now = dependencies.now();
  const previousKey = selectedCampaignKey(state);
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
  await dependencies.onCampaignRefresh();
  await dependencies.onAdvanceQueueIfCompleted();
  if (selectionChanged(state, previousKey)) {
    return { kind: 'selection-changed' };
  }
  await dependencies.onInventoryRefresh();
  await dependencies.onAdvanceQueueIfCompleted();
  if (selectionChanged(state, previousKey)) {
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
    await dependencies.onRestartTablessWatcher();
  } else if (attempt === 1) {
    await dependencies.onAttemptPlaybackSelfHeal(source.tabId);
  } else {
    await dependencies.onRotateManagedStreamer();
  }

  if (selectionChanged(state, previousKey)) {
    return { kind: 'selection-changed' };
  }
  state.recoveryBackoffUntil = retryAt;
  applyRecoveryState(state, 'stalled-progress', retryAt);
  await dependencies.onSaveState();
  await dependencies.onSaveTimingState(state);
  return { kind: 'retry-scheduled', attempt, retryAt, started: true };
}
