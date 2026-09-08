// Owns one monitoring tick, including transport, refresh, claim, and queue sequencing.
import { browser } from '../shared/browser-api.ts';
import { gameKey } from '../shared/game-selection';
import { isStreamerAcquisitionRecovery } from '../shared/runtime-status.ts';
import {
  CRASH_RECOVERY_GRACE_MS,
  INVENTORY_REFRESH_INTERVAL_MS,
  STREAM_VALIDATION_GRACE_MS,
  TICK_WATCHDOG_TIMEOUT_MS,
} from './constants';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { logDebug, logWarn } from './logging';
import type { ServiceWorkerState } from './runtime-state.ts';

export interface CheckDropProgressCallbacks {
  onEnforcePlaybackPolicy: () => Promise<void>;
  onRotateStreamerIfInvalid: (isCurrent?: () => boolean) => Promise<void>;
  onAcquireStreamerForSelectedGame: (isCurrent?: () => boolean) => Promise<boolean>;
  onAttemptAutoClaimChannelPointsBonus: () => Promise<boolean>;
  onRefreshDropsData: (opts?: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    isCurrent?: () => boolean;
  }) => Promise<RefreshDropsOutcome>;
  onAutoClaimClaimableDrops: () => Promise<boolean>;
  onAdvanceQueueIfCompleted: () => Promise<boolean>;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
  onWatchTransportTick?: (isCurrent: () => boolean) => Promise<boolean | undefined>;
}

export async function checkDropProgress(
  state: ServiceWorkerState,
  callbacks: CheckDropProgressCallbacks,
): Promise<void> {
  if (!state.appState.isRunning || state.appState.isPaused) {
    return;
  }

  logDebug('Tick entry', {
    isRunning: state.appState.isRunning,
    isPaused: state.appState.isPaused,
    monitorTickInFlight: state.monitorTickInFlight,
    apiBackoffActive: state.apiBackoffUntil > Date.now(),
  });

  if (state.monitorTickInFlight) {
    logDebug('Tick skipped — monitorTickInFlight already true');
    return;
  }
  state.monitorTickInFlight = true;
  state.lastHeartbeatAt = Date.now();
  const myTickGeneration = state.tickGeneration;
  const ownsTick = () => state.tickGeneration === myTickGeneration;
  const isCurrent = () => ownsTick() && state.appState.isRunning && !state.appState.isPaused;
  const isStaleTick = () => {
    if (!isCurrent()) {
      logDebug('Tick generation stale (session stopped/restarted mid-tick) — aborting');
      return true;
    }
    return false;
  };

  const tickWatchdogTimer = setTimeout(() => {
    if (ownsTick() && state.monitorTickInFlight) {
      logWarn('Monitoring tick watchdog fired — resetting stuck monitorTickInFlight flag', {
        timeoutMs: TICK_WATCHDOG_TIMEOUT_MS,
      });
      state.tickGeneration += 1;
      state.monitorTickInFlight = false;
    }
  }, TICK_WATCHDOG_TIMEOUT_MS);

  try {
    const transportAdvancedQueue = await callbacks.onWatchTransportTick?.(isCurrent);
    if (isStaleTick()) return;
    if (transportAdvancedQueue) return;

    if (state.apiBackoffUntil > 0 && Date.now() < state.apiBackoffUntil) {
      logDebug('API backoff active, skipping network refresh work', {
        remainingMs: state.apiBackoffUntil - Date.now(),
      });
      await callbacks.onAutoClaimClaimableDrops();
      if (isStaleTick()) return;
      return;
    }

    if (!isStreamerAcquisitionRecovery(state.appState.recoveryReason)) {
      if (state.appState.tabId) {
        const streamTab = await browser.tabs.get(state.appState.tabId).catch(() => null);
        if (isStaleTick()) return;
        if (!streamTab) {
          state.appState.tabId = null;
          state.appState.activeStreamer = null;
        }
      }
      await callbacks.onEnforcePlaybackPolicy();
      if (isStaleTick()) return;
    }

    // Transport stays on the minute heartbeat; inventory is deliberately slower.
    if (Date.now() - state.lastInventoryRefreshAt >= INVENTORY_REFRESH_INTERVAL_MS) {
      await callbacks.onRefreshDropsData({
        includeCampaignFetch: false,
        includeInventoryFetch: true,
        isCurrent,
      });
      if (isStaleTick()) return;
      state.lastInventoryRefreshAt = Date.now();
    }

    const claimedAny = await callbacks.onAutoClaimClaimableDrops();
    if (isStaleTick()) return;
    // Confirm a successful claim from inventory before queue mutation without
    // coupling claim handling back to a full campaign refresh.
    if (claimedAny) {
      await callbacks.onRefreshDropsData({
        includeCampaignFetch: false,
        includeInventoryFetch: true,
        isCurrent,
      });
      if (isStaleTick()) return;
      state.lastInventoryRefreshAt = Date.now();
    }

    const selectedBeforeAdvance = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    const advancedBeforeValidation = await callbacks.onAdvanceQueueIfCompleted();
    if (isStaleTick()) return;
    if (!advancedBeforeValidation || !state.appState.isRunning || state.appState.isPaused) {
      return;
    }
    const selectedAfterAdvance = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    if (selectedBeforeAdvance !== selectedAfterAdvance) {
      return;
    }

    const streamerAcquisitionRecoveryActive = isStreamerAcquisitionRecovery(state.appState.recoveryReason);
    if (streamerAcquisitionRecoveryActive) {
      if (Date.now() >= state.recoveryBackoffUntil) {
        await callbacks.onAcquireStreamerForSelectedGame(isCurrent);
      }
      return;
    }

    const inCrashGrace =
      state.appState.resumedFromCrash != null &&
      Date.now() - state.appState.resumedFromCrash < CRASH_RECOVERY_GRACE_MS;
    if (inCrashGrace) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    } else {
      if (state.appState.resumedFromCrash != null) {
        state.appState.resumedFromCrash = null;
      }
      await callbacks.onRotateStreamerIfInvalid(isCurrent);
      if (isStaleTick()) return;
      if (!state.appState.isRunning || state.appState.isPaused) {
        return;
      }
    }
    await callbacks.onAttemptAutoClaimChannelPointsBonus();
    if (isStaleTick()) return;
    await callbacks.onAdvanceQueueIfCompleted();
  } finally {
    clearTimeout(tickWatchdogTimer);
    if (ownsTick()) {
      state.monitorTickInFlight = false;
      await callbacks.onSaveTimingState(state);
    }
  }
}
