import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url';
import type { AppState } from '../types/index.ts';
import { logDebug } from './logging';

export interface ChannelPointsBonusClaimResponse {
  success?: boolean;
  claimed?: boolean;
  reason?: 'claimed' | 'not-available' | 'not-supported-page';
}

export function applyAutoClaimChannelPointsBonusSetting(
  state: AppState,
  enabled: boolean | undefined,
): AppState {
  return {
    ...state,
    autoClaimChannelPointsBonus: enabled === true,
  };
}

export function shouldAttemptAutoClaimChannelPointsBonus(state: AppState): boolean {
  return state.isRunning && !state.isPaused && state.autoClaimChannelPointsBonus && state.tabId != null;
}

// Dependencies for `attemptAutoClaimChannelPointsBonusExt`. Injected so the
// extracted function owns the *claim flow shape* while the service worker
// remains the seam that wires real browser APIs (tabs API, content-script
// orchestration, the bonus-claimed side-effect).
export interface ChannelPointsClaimDeps {
  ensureContentScriptOnTab: (tabId: number) => Promise<unknown> | unknown;
  sendMessageToTab: (tabId: number, message: unknown) => Promise<ChannelPointsBonusClaimResponse | null>;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string } | null>;
  recordBonusClaimed: (channelName: string | null) => Promise<void>;
}

export async function attemptAutoClaimChannelPointsBonusExt(
  state: AppState,
  deps: ChannelPointsClaimDeps,
): Promise<boolean> {
  if (!shouldAttemptAutoClaimChannelPointsBonus(state)) {
    return false;
  }

  const tabId = state.tabId;
  if (tabId == null) {
    return false;
  }

  const tab = await deps.getTab(tabId);
  if (!tab?.id) {
    return false;
  }

  await deps.ensureContentScriptOnTab(tab.id);
  const result = await deps.sendMessageToTab(tab.id, {
    type: 'CLAIM_CHANNEL_POINTS_BONUS',
  });

  if (result?.success && result.claimed) {
    const channelName =
      getFarmableTwitchChannelNameFromUrl(tab.url) ?? state.activeStreamer?.displayName ?? null;
    logDebug('Auto-claimed channel points bonus', { tabId: tab.id, channelName });
    await deps.recordBonusClaimed(channelName);
    return true;
  }

  return false;
}

// Dependencies for `recordChannelPointsBonusClaimedExt`. Injected so the
// function owns the *counter + notification policy* (persisted state +
// user-facing notify) without referencing the global `state` or browser
// storage directly — making it testable without storage mocks.
export interface ChannelPointsRecordingDeps {
  saveState: () => Promise<void>;
  notify: (title: string, message: string, priority?: number) => Promise<unknown> | unknown;
  awaitInit: () => Promise<void>;
}

export async function recordChannelPointsBonusClaimedExt(
  state: AppState,
  deps: ChannelPointsRecordingDeps,
  channelName?: string | null,
): Promise<void> {
  await deps.awaitInit();
  state.totalChannelPointsClaimed = state.totalChannelPointsClaimed + 1;
  await deps.saveState();
  const fromChannel = channelName ? ` from ${channelName}` : '';
  await deps.notify('Channel points claimed', `Claimed${fromChannel}.`, 0);
}
