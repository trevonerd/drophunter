import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
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

function isTrustedTwitchSender(sender: Browser.runtime.MessageSender): boolean {
  const url = sender.tab?.url ?? sender.url ?? '';
  if (getFarmableTwitchChannelNameFromUrl(url) !== null) return true;
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)twitch\.tv$/i.test(parsed.hostname) &&
      /^\/drops\/(campaigns|inventory)(?:\/|$)/i.test(parsed.pathname)
    );
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
  async function handleSyncTwitchSession(payload: unknown, sender: Browser.runtime.MessageSender) {
    if (!isTrustedTwitchSender(sender)) return { success: false, error: 'Untrusted message sender' };
    const epoch = currentFarmingSessionEpoch(state);
    const isCurrent = () => currentFarmingSessionEpoch(state) === epoch;
    await dependencies.awaitInitialization();
    const recoveryIntent = isCurrent() ? twitchSessionRecoveryIntent(state.appState) : 'none';
    const result = await syncTwitchSessionFromContentScriptExt(
      state,
      sessionPayloadCandidate(payload),
      sender.tab?.id,
      {
        shouldRefreshCampaignsAfterSessionSync: dependencies.shouldRefreshCampaignsAfterSessionSync,
        onRefreshCampaigns: () => (isCurrent() ? dependencies.requestAuthRecoveredSync() : Promise.resolve()),
        onSaveState: () => saveState(state),
        onBroadcastStateUpdate: () => broadcastStateUpdate(state.appState),
      },
    );
    if (!result.success || !isCurrent()) return result;
    markTwitchSessionReady(state);
    if (
      recoveryIntent === 'resume' &&
      !state.appState.isPaused &&
      (!state.appState.lastStopReason || state.appState.lastStopReason === 'sign-in-required')
    )
      await dependencies.resumeAfterAuthRecovery();
    else await saveState(state);
    broadcastStateUpdate(state.appState);
    return result;
  }

  async function handleSyncTwitchIntegrity(
    payload:
      | { readonly token?: string; readonly expiration?: number; readonly request_id?: string }
      | undefined,
    sender: Browser.runtime.MessageSender | undefined,
  ) {
    if (!sender || !isTrustedTwitchSender(sender))
      return { success: false, error: 'Untrusted message sender' };
    await dependencies.awaitInitialization();
    const previousToken = state.twitchSessionCache?.clientIntegrity;
    const result = await syncTwitchIntegrityFromContentScriptExt(state, payload);
    const sync = state.appState.campaignSyncState;
    if (
      result.success &&
      payload?.token?.trim() !== previousToken &&
      sync.lastErrorKind === 'integrity' &&
      (sync.status === 'retry-scheduled' || sync.status === 'retry-failed')
    ) {
      await dependencies.requestAuthRecoveredSync();
    }
    return result;
  }

  async function handleChannelPointsBonusClaimed(
    payload: { readonly channelName?: string | null } | undefined,
    sender: Browser.runtime.MessageSender,
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
