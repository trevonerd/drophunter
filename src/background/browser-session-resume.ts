import { browser } from '../shared/browser-api.ts';
import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import {
  CRASH_DETECTION_THRESHOLD_MS,
  RESUME_RECOVERY_GRACE_MS,
  STREAM_VALIDATION_GRACE_MS,
} from './constants.ts';
import { logInfo, logWarn } from './logging.ts';
import { restartQueueAcquisitionRound } from './queue-acquisition-round.ts';
import { clearRecoveryState } from './recovery-state.ts';
import {
  applyStartupAutoResumeTransition,
  applyStartupResumePolicy,
  type ServiceWorkerState,
} from './runtime-state.ts';
import { saveState, saveTimingState } from './state-persistence.ts';

const BROWSER_SESSION_SEEN_KEY = 'farmingBrowserSessionSeen';

async function markBrowserSessionSeen(): Promise<void> {
  try {
    await browser.storage.session.set({ [BROWSER_SESSION_SEEN_KEY]: true });
  } catch (error) {
    logWarn('Cannot persist browser session marker for farming resume', { error: String(error) });
  }
}

async function canResumeWithExistingManagedTab(state: ServiceWorkerState): Promise<boolean> {
  const tabId = state.appState.tabId;
  if (!tabId) return false;
  const tab = await browser.tabs.get(tabId).catch(() => null);
  return Boolean(tab?.id && getFarmableTwitchChannelNameFromUrl(tab.url));
}

export async function prepareBrowserSessionResume(state: ServiceWorkerState): Promise<void> {
  let browserSessionSeen: boolean;
  try {
    const stored = await browser.storage.session.get([BROWSER_SESSION_SEEN_KEY]);
    browserSessionSeen = stored[BROWSER_SESSION_SEEN_KEY] === true;
  } catch (error) {
    // Unavailable session storage cannot justify pausing an active queue.
    logWarn('Cannot determine browser session for farming resume', { error: String(error) });
    return;
  }
  if (browserSessionSeen) return;

  const now = Date.now();
  const policy = applyStartupResumePolicy(
    state,
    now,
    CRASH_DETECTION_THRESHOLD_MS,
    RESUME_RECOVERY_GRACE_MS,
    true,
  );
  restartQueueAcquisitionRound(state, now);
  state.appState.queueAcquisitionRound = null;
  clearRecoveryState(state);
  state.appState.watchHealth = null;
  state.appState.lastAutomationMessage = null;
  state.appState.automationActivity = [];
  state.appState.lastDropsPageRefreshError = null;
  state.appState.campaignFailureEpisodesByKey = Object.fromEntries(
    Object.entries(state.appState.campaignFailureEpisodesByKey).map(([key, episode]) => [
      key,
      { ...episode, visible: false },
    ]),
  );
  const proof = state.apiRetryAfterVerifiedAt ?? 0;
  if (
    !(
      proof > 0 &&
      proof <= now &&
      now - proof < 24 * 60 * 60_000 &&
      state.apiBackoffUntil > proof &&
      state.apiBackoffUntil <= proof + 24 * 60 * 60_000
    )
  ) {
    state.apiBackoffUntil = 0;
    state.apiConsecutiveFailures = 0;
    state.apiRetryAfterVerifiedAt = 0;
  }
  state.lastProgressAdvanceAt = 0;
  state.lastInventoryRefreshAt = 0;
  state.lastFullRefreshAt = 0;
  if (!state.appState.isPaused && state.appState.lastStopReason !== 'user-stop') {
    state.appState.lastStopReason = null;
    state.appState.lastStopMessage = null;
  }
  await saveState(state);
  await saveTimingState(state, { immediate: true });
  if (
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.appState.selectedGame &&
    campaignRejectionReason(state.appState.selectedGame, now)
  ) {
    await markBrowserSessionSeen();
    return;
  }
  if (policy === 'resume-recovery') {
    logInfo('Browser session restored during active no-tab recovery; resuming monitoring', {
      recoveryReason: state.appState.recoveryReason,
      recoveryAttempts: state.appState.recoveryAttempts,
      secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
    });
    await markBrowserSessionSeen();
    return;
  }
  if (policy !== 'auto-resume') {
    await markBrowserSessionSeen();
    return;
  }
  const keptExistingTab = await canResumeWithExistingManagedTab(state);
  logInfo(
    keptExistingTab
      ? 'Browser restart detected; resuming with existing Twitch tab'
      : 'Browser restart detected; reopening streamer',
    { secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000) },
  );
  applyStartupAutoResumeTransition(state, now, STREAM_VALIDATION_GRACE_MS);
  if (!keptExistingTab) {
    state.appState.tabId = null;
    // Browser restart changes tab IDs. Keep the target until durable ownership
    // reconstruction can find the restored page or reject the stale watch.
  }
  await saveState(state);
  await saveTimingState(state, { immediate: true });
  await markBrowserSessionSeen();
}
