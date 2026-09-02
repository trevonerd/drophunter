import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  syncTwitchIntegrityFromContentScriptExt,
  syncTwitchSessionFromContentScriptExt,
} from './session-management.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import { markTwitchSessionReady } from './twitch-session-sync.ts';

export type TwitchSessionRecoveryIntent = 'none' | 'continue' | 'resume';

export function twitchSessionRecoveryIntent(
  appState: Pick<ServiceWorkerState['appState'], 'lastStopReason' | 'twitchSessionSyncState'>,
): TwitchSessionRecoveryIntent {
  if (appState.lastStopReason === 'sign-in-required') return 'resume';
  if (appState.twitchSessionSyncState.status === 'retrying') return 'continue';
  return 'none';
}

interface ContentHandlerDependencies {
  awaitInitialization: () => Promise<unknown>;
  shouldRefreshCampaignsAfterSessionSync: () => boolean;
  requestAuthRecoveredSync: () => Promise<unknown>;
  resumeAfterAuthRecovery: () => Promise<unknown>;
  recordChannelPointsBonusClaimed: (channelName?: string | null) => Promise<void>;
}

function isTrustedTwitchSender(sender: chrome.runtime.MessageSender): boolean {
  const url = sender.tab?.url ?? sender.url ?? '';
  if (getFarmableTwitchChannelNameFromUrl(url) !== null) return true;
  try {
    const parsed = new URL(url);
    return /(^|\.)twitch\.tv$/i.test(parsed.hostname) && /^\/drops\/campaigns(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function sessionPayloadCandidate(payload: unknown): unknown {
  return payload && typeof payload === 'object' && 'session' in payload ? payload.session : payload;
}

export function createServiceWorkerTwitchContentHandlers(
  state: ServiceWorkerState,
  dependencies: ContentHandlerDependencies,
) {
  async function handleSyncTwitchSession(payload: unknown, sender: chrome.runtime.MessageSender) {
    if (!isTrustedTwitchSender(sender)) return { success: false, error: 'Untrusted message sender' };
    await dependencies.awaitInitialization();
    const recoveryIntent = twitchSessionRecoveryIntent(state.appState);
    const result = await syncTwitchSessionFromContentScriptExt(
      state,
      sessionPayloadCandidate(payload),
      sender.tab?.id,
      {
        shouldRefreshCampaignsAfterSessionSync: dependencies.shouldRefreshCampaignsAfterSessionSync,
        onRefreshCampaigns: dependencies.requestAuthRecoveredSync,
        onSaveState: () => saveState(state),
        onBroadcastStateUpdate: () => broadcastStateUpdate(state.appState),
      },
    );
    if (!result.success) return result;
    markTwitchSessionReady(state);
    if (recoveryIntent === 'resume') await dependencies.resumeAfterAuthRecovery();
    else await saveState(state);
    broadcastStateUpdate(state.appState);
    return result;
  }

  async function handleSyncTwitchIntegrity(
    payload:
      | { readonly token?: string; readonly expiration?: number; readonly request_id?: string }
      | undefined,
    sender: chrome.runtime.MessageSender | undefined,
  ) {
    if (!sender || !isTrustedTwitchSender(sender))
      return { success: false, error: 'Untrusted message sender' };
    return syncTwitchIntegrityFromContentScriptExt(state, payload);
  }

  async function handleChannelPointsBonusClaimed(
    payload: { readonly channelName?: string | null } | undefined,
    sender: chrome.runtime.MessageSender,
  ) {
    if (!isTrustedTwitchSender(sender)) return { success: false, error: 'Untrusted message sender' };
    logDebug('Channel points bonus claimed by content script', { tabId: sender.tab?.id });
    const channelName =
      payload?.channelName ?? getFarmableTwitchChannelNameFromUrl(sender.tab?.url ?? '') ?? null;
    await dependencies.recordChannelPointsBonusClaimed(channelName);
    return { success: true };
  }

  return { handleChannelPointsBonusClaimed, handleSyncTwitchIntegrity, handleSyncTwitchSession };
}
