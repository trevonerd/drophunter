import { isRewardAutomatable, isTwitchNativeReward } from '../shared/reward-semantics.ts';
import { AppState, TwitchDrop } from '../types/index.ts';
import { recordClaimedDrops } from './claim-log.ts';
import { DROP_CLAIM_RETRY_COOLDOWN_MS } from './constants.ts';
import { splitDropsForSelectedGame } from './drops-projection.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './service-worker.ts';
import { ensureSessionIntegrity } from './session-management.ts';
import { saveState } from './state-persistence.ts';
import { TwitchApiClient } from './twitch-api/client.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export function applyAutoClaimDropsSetting(st: AppState, enabled: boolean | undefined): AppState {
  return {
    ...st,
    autoClaimDrops: enabled === true,
  };
}

export function shouldAttemptAutoClaimDrops(st: AppState): boolean {
  return st.isRunning && !st.isPaused && st.autoClaimDrops;
}

export function canRetryDropClaim(state: ServiceWorkerState, claimId: string): boolean {
  const retryAt = state.dropClaimRetryAtById.get(claimId) ?? 0;
  return Date.now() >= retryAt;
}

function asClaimedDrop(drop: TwitchDrop): TwitchDrop {
  return {
    ...drop,
    claimed: true,
    claimable: false,
    progress: 100,
    remainingMinutes: 0,
    verificationState: isTwitchNativeReward(drop) ? 'verified' : drop.verificationState,
    status: 'completed' as const,
  };
}

function matchesClaimedDrop(
  drop: TwitchDrop,
  claimId: string,
  fallbackDropId?: string,
  fallbackCampaignId?: string,
): boolean {
  if (drop.claimId === claimId) return true;
  if (!fallbackDropId || drop.id !== fallbackDropId) return false;
  // When campaignId is provided by the caller, require an exact campaign match to
  // prevent claiming the wrong drop when Twitch reuses drop ids across campaigns.
  if (fallbackCampaignId !== undefined) {
    return (drop.campaignId ?? '') === fallbackCampaignId;
  }
  return true;
}

export function markDropClaimedLocally(
  state: ServiceWorkerState,
  claimId: string,
  fallbackDropId?: string,
  fallbackCampaignId?: string,
): boolean {
  let changed = false;
  state.appState.allDrops = state.appState.allDrops.map((drop) => {
    if (!matchesClaimedDrop(drop, claimId, fallbackDropId, fallbackCampaignId)) return drop;
    changed = true;
    return asClaimedDrop(drop);
  });

  if (changed) {
    splitDropsForSelectedGame(state, state.appState.allDrops);
  }

  return changed;
}

export function markDropClaimedInSnapshot(
  state: ServiceWorkerState,
  claimId: string,
  fallbackDropId?: string,
  fallbackCampaignId?: string,
): void {
  for (let i = 0; i < state.cachedDropsSnapshot.length; i++) {
    const drop = state.cachedDropsSnapshot[i];
    if (matchesClaimedDrop(drop, claimId, fallbackDropId, fallbackCampaignId)) {
      state.cachedDropsSnapshot[i] = asClaimedDrop(drop);
      return;
    }
  }
}

export async function claimDropViaApi(
  state: ServiceWorkerState,
  drop: TwitchDrop,
  getSession: () => Promise<TwitchSession | null>,
): Promise<boolean> {
  const claimId = (drop.claimId ?? '').trim();
  if (!claimId) {
    logWarn('Auto-claim skipped: missing claimId', { dropId: drop.id, dropName: drop.name });
    return false;
  }

  if (!canRetryDropClaim(state, claimId)) {
    logDebug('Auto-claim cooldown active', { claimId, dropName: drop.name });
    return false;
  }

  let lastError: unknown = null;
  try {
    const session = await getSession();
    if (!session) {
      logWarn('Auto-claim skipped: Twitch session unavailable', { claimId, dropName: drop.name });
    } else {
      logDebug('Auto-claim attempt', { claimId, dropName: drop.name, game: drop.gameName });
      const sessionWithIntegrity = await ensureSessionIntegrity(state, session);
      const client = new TwitchApiClient(sessionWithIntegrity);
      if (await client.claimDropReward(claimId)) {
        state.dropClaimRetryAtById.delete(claimId);
        logInfo('Auto-claim success', { claimId, dropName: drop.name });
        return true;
      }
    }
  } catch (error) {
    lastError = error;
    logWarn('Drop claim attempt failed:', String(error));
  }

  state.dropClaimRetryAtById.set(claimId, Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS);
  logWarn('Auto-claim failed, scheduled retry', {
    claimId,
    dropName: drop.name,
    error: lastError === null ? undefined : String(lastError),
  });
  return false;
}

export async function autoClaimClaimableDrops(
  state: ServiceWorkerState,
  getSession: () => Promise<TwitchSession | null>,
  onDropClaimed?: (drop: TwitchDrop) => void | Promise<void>,
): Promise<boolean> {
  if (!shouldAttemptAutoClaimDrops(state.appState)) {
    return false;
  }

  if (state.dropClaimInFlight) {
    return false;
  }

  const now = Date.now();
  for (const [id, retryAt] of state.dropClaimRetryAtById) {
    if (now >= retryAt) {
      state.dropClaimRetryAtById.delete(id);
    }
  }

  const claimTargets = state.cachedDropsSnapshot
    .filter((drop) => Boolean(drop.claimable) && !drop.claimed)
    .filter((drop) => Boolean((drop.claimId ?? '').trim()))
    .filter(isRewardAutomatable);

  if (claimTargets.length === 0) {
    return false;
  }

  state.dropClaimInFlight = true;
  let claimedAny = false;
  const claimedDrops: TwitchDrop[] = [];
  try {
    for (const drop of claimTargets) {
      const claimed = await claimDropViaApi(state, drop, getSession);
      if (!claimed || !drop.claimId) {
        continue;
      }
      markDropClaimedLocally(state, drop.claimId, drop.id, drop.campaignId);
      markDropClaimedInSnapshot(state, drop.claimId, drop.id, drop.campaignId);
      claimedDrops.push(asClaimedDrop(drop));
      claimedAny = true;
      if (onDropClaimed) await onDropClaimed(drop);
    }

    if (claimedAny) {
      await recordClaimedDrops(state, claimedDrops);
      await saveState(state);
    }

    return claimedAny;
  } finally {
    state.dropClaimInFlight = false;
  }
}
