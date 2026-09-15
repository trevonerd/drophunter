import { browser } from '../shared/browser-api.ts';
import { loadStoredContentAppState, subscribeToContentAppState } from './app-state.ts';
import { claimChannelPointsBonus } from './channel-points.ts';
import { handleRuntimeMessage } from './content-messages.ts';
import {
  handleIntegrityEvent,
  INTEGRITY_STORAGE_KEY,
  syncIntegrityToBackground,
  syncTwitchSessionToBackground,
} from './content-session.ts';
import { logContentDebug } from './logging.ts';
import { extractChannelNameFromPath } from './stream-context.ts';

let appStateUnsubscribe: (() => void) | null = null;
let cleanedUp = false;
let contentScriptStarted = false;
let cleanupInterval: number | null = null;
let delayedSyncTimeout: number | null = null;

function hasActiveExtensionContext(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

function cleanupContentScript(): void {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  browser.runtime.onMessage.removeListener(handleRuntimeMessage);
  window.removeEventListener(INTEGRITY_STORAGE_KEY, handleIntegrityEvent);
  if (cleanupInterval !== null) {
    window.clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (delayedSyncTimeout !== null) {
    window.clearTimeout(delayedSyncTimeout);
    delayedSyncTimeout = null;
  }
  stopChannelPointsAutoClaim();
  appStateUnsubscribe?.();
  appStateUnsubscribe = null;
}

let autoClaimEnabled = false;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let lastClaimAttemptAt = 0;

const CHANNEL_POINTS_POLL_MS = 1_000;
const CHANNEL_POINTS_CLAIM_COOLDOWN_MS = 5_000;

function isSupportedChannelPointsPage(): boolean {
  return extractChannelNameFromPath() !== null;
}

function tryClaimBonus(): void {
  if (!autoClaimEnabled || !isSupportedChannelPointsPage()) {
    return;
  }
  const now = Date.now();
  if (now - lastClaimAttemptAt < CHANNEL_POINTS_CLAIM_COOLDOWN_MS) {
    return;
  }
  const result = claimChannelPointsBonus(document, { supportedPage: true });
  if (result.claimed === true) {
    lastClaimAttemptAt = now;
    const channelName = extractChannelNameFromPath();
    logContentDebug('Auto-claimed channel points bonus');
    browser.runtime
      .sendMessage({ type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName } })
      .catch(() => {});
  }
}

function startChannelPointsAutoClaim(): void {
  if (pollIntervalId !== null) {
    return;
  }
  pollIntervalId = setInterval(tryClaimBonus, CHANNEL_POINTS_POLL_MS);
  tryClaimBonus();
}

function stopChannelPointsAutoClaim(): void {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

export function startContentScript(): void {
  const globals = window as Window & { __drophunter_content__?: boolean };
  if (contentScriptStarted || globals.__drophunter_content__) {
    return;
  }
  contentScriptStarted = true;
  globals.__drophunter_content__ = true;

  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener(INTEGRITY_STORAGE_KEY, handleIntegrityEvent);

  // Clean up when extension context is invalidated (MV3 content script teardown).
  cleanupInterval = window.setInterval(() => {
    if (!hasActiveExtensionContext()) {
      cleanupContentScript();
    }
  }, 5000);

  // Read any integrity token that was already captured before this script loaded.
  syncIntegrityToBackground('sessionStorage');

  delayedSyncTimeout = window.setTimeout(() => {
    syncTwitchSessionToBackground();
    // Re-check sessionStorage in case integrity was fetched between page load
    // and content script initialization.
    syncIntegrityToBackground('delayed-check');
  }, 900);

  loadStoredContentAppState()
    .then((state) => {
      autoClaimEnabled = state.autoClaimChannelPointsBonus !== false;
      if (autoClaimEnabled) startChannelPointsAutoClaim();
    })
    .catch(() => undefined);
  appStateUnsubscribe = subscribeToContentAppState((state) => {
    autoClaimEnabled = state.autoClaimChannelPointsBonus !== false;
    if (autoClaimEnabled) startChannelPointsAutoClaim();
    else stopChannelPointsAutoClaim();
  });
}
