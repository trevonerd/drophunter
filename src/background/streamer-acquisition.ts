// ============================================================================
// streamer-acquisition.ts — Streamer acquisition and rotation policy
//
// Owns: acquiring a fresh streamer for the selected game, rotating off an
//   invalid/stalled streamer, deciding when a streamer qualifies as "still
//   progressing" (shouldKeepStreamerWhileDropProgresses), and picking the
//   best-matching channel for the selected game (filterStreamersByAllowedChannels
//   + openBestStreamerForSelectedGame).
// Caller owns: WHEN to invoke each operation, persistence/broadcast triggers,
//   skip/advance decision policy (callers pass onSkipCurrentGame to drive queue
//   advancement), and DI wiring of fetch/close foreground callbacks.
// DAG-leaf invariant: imports only shared utilities, recovery-state, stream-rotation,
//   streamer-selection, logging, constants, types, and ServiceWorkerState type.
//   MUST NOT import from queue-management (host re-exports for backward compat),
//   drops-projection, state-persistence, claim-log.
// ============================================================================
import { browser } from '../shared/browser-api.ts';
import { haveAllDropsExpiredOrVanished } from '../shared/drops';
import { getGameDisplayLabel } from '../shared/game-selection';
import { normalizeToken } from '../shared/matching';
import { TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { INVALID_STREAM_THRESHOLD, STREAM_ROTATE_COOLDOWN_MS } from './constants';
import { logDebug, logInfo, logWarn } from './logging';
import {
  applyNoStreamersRecoveryState,
  applyRecoveryState,
  clearNoStreamersRecoveryState,
  clearRecoveryState,
} from './recovery-state';
import type { ServiceWorkerState } from './service-worker';
import {
  classifyStreamHealth,
  computeEffectiveStallThreshold,
  MAX_NO_STREAMERS_RETRIES,
  MAX_PERSISTENT_RECOVERY_CYCLES,
  MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
  NO_DROPS_SIGNAL_STALL_THRESHOLD_MS,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  OFFLINE_CONFIRMATION_CHECKS,
  STALLED_PROGRESS_RETRY_MS,
  StreamRotationReason,
} from './stream-rotation';
import { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection';

// ============================================================================
// Internal helpers (private to this module)
// ============================================================================

function shouldKeepStreamerWhileDropProgresses(input: {
  currentDrop: TwitchDrop | null;
  lastProgressAdvanceAt: number;
  now: number;
  effectiveThresholdMs: number;
  reason: StreamRotationReason | null;
}): boolean {
  const fatalReason =
    input.reason === 'offline' ||
    input.reason === 'navigated-away' ||
    input.reason === 'open-failed' ||
    input.reason === 'no-streamers' ||
    input.reason === 'stalled-progress';
  return (
    !fatalReason &&
    input.currentDrop != null &&
    input.lastProgressAdvanceAt > 0 &&
    input.now - input.lastProgressAdvanceAt < input.effectiveThresholdMs
  );
}

function filterStreamersByAllowedChannels(
  streamers: TwitchStreamer[],
  allowed: string[] | null,
): TwitchStreamer[] {
  if (allowed == null || allowed.length === 0) {
    return streamers;
  }
  const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
  return streamers.filter((streamer) => allowedSet.has(streamer.name.toLowerCase()));
}

// ============================================================================
// Exported interface
// ============================================================================

export interface OpenBestStreamerCallbacks {
  onFetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  onOpenForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
}

// ============================================================================
// Main public API
// ============================================================================

export async function acquireStreamerForSelectedGame(
  state: ServiceWorkerState,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onSkipCurrentGame?: () => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<boolean> {
  if (!state.appState.selectedGame) {
    return false;
  }

  const now = Date.now();
  const isNoStreamersRecovery = state.appState.recoveryReason === 'no-streamers';
  if (isNoStreamersRecovery && state.recoveryBackoffUntil > now) {
    return false;
  }

  const opened = opts?.onOpenStreamer ? await opts.onOpenStreamer() : false;
  if (opened) {
    clearNoStreamersRecoveryState(state);
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    }
    return true;
  }

  const previousAttempts = isNoStreamersRecovery ? Math.max(0, state.appState.recoveryAttempts ?? 0) : 0;
  if (previousAttempts >= MAX_NO_STREAMERS_RETRIES) {
    if (opts?.onSkipCurrentGame) {
      await opts.onSkipCurrentGame();
    }
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    }
    return false;
  }

  const retryAt = now + NO_STREAMERS_RETRY_MS;
  applyNoStreamersRecoveryState(state, retryAt, previousAttempts + 1);
  logWarn('No live streamers found; scheduling one retry', {
    game: getGameDisplayLabel(state.appState.selectedGame),
    retryAt,
    attempts: previousAttempts + 1,
  });
  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  if (opts?.onSaveTimingState) {
    await opts.onSaveTimingState(state);
  }
  return false;
}

export async function rotateStreamer(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onEnterPersistentRecovery?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      message: string,
      opts?: {
        onSkipCurrentGame?: () => Promise<void>;
        onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
      },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
  },
): Promise<boolean> {
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);

  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = Date.now();
  state.lastStreamRotationAt = Date.now();
  // Give the next streamer a fresh stall window so it is not judged against the old timeline.
  state.lastProgressAdvanceAt = Date.now();
  state.offlineChecks = 0;
  // Remember the channel we are leaving so the next selection picks a different one.
  if (state.appState.activeStreamer?.name) {
    state.avoidStreamerName = state.appState.activeStreamer.name;
  }
  state.appState.activeStreamer = null;

  let opened = false;
  if (opts?.onOpenStreamer) {
    opened = await opts.onOpenStreamer();
  }
  if (!opened && reason === 'stalled-progress' && opts?.onSkipCurrentGame) {
    await opts.onSkipCurrentGame();
  }

  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  if (opts?.onSaveTimingState) {
    await opts.onSaveTimingState(state);
  }
  return opened;
}

export async function rotateStreamerIfInvalid(
  state: ServiceWorkerState,
  opts?: {
    onFetchStreamContext?: (tabId: number) => Promise<{
      channelName: string;
      categorySlug: string;
      categoryLabel: string;
      streamTitle: string;
      titleContainsDrops: boolean;
      hasDropsSignal: boolean;
      isLive: boolean;
      pageUrl: string;
    } | null>;
    onResolveCategorySlug?: (game: TwitchGame) => Promise<string>;
    onAttemptPlaybackSelfHeal?: (tabId: number) => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onRotateStreamer?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      opts?: {
        onOpenStreamer?: () => Promise<boolean>;
        onSaveState?: () => Promise<void>;
        onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
        onEnterPersistentRecovery?: (
          state: ServiceWorkerState,
          reason: StreamRotationReason,
          message: string,
          opts?: {
            onSkipCurrentGame?: () => Promise<void>;
            onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
          },
        ) => Promise<void>;
        onSkipCurrentGame?: () => Promise<void>;
      },
    ) => Promise<boolean>;
    onOpenStreamer?: () => Promise<boolean>;
    onEnterPersistentRecovery?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      message: string,
      opts?: {
        onSkipCurrentGame?: () => Promise<void>;
        onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
      },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
    onForceRefreshDropsData?: () => Promise<void>;
  },
) {
  if (!state.appState.selectedGame) {
    return;
  }

  if (!state.appState.tabId) {
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
    ) {
      return;
    }
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'open-failed', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  const tab = await browser.tabs.get(state.appState.tabId).catch(() => null);
  if (!tab?.id) {
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
    ) {
      return;
    }
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'open-failed', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  const context = opts?.onFetchStreamContext ? await opts.onFetchStreamContext(tab.id) : null;

  const now = Date.now();
  if (now < state.streamValidationGraceUntil) {
    return;
  }
  const effectiveThreshold = computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);

  if (!context) {
    const tabUrl = tab.url ?? '';
    const isStillOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(tabUrl);
    if (!isStillOnTwitch) {
      logInfo('Managed tab navigated away from Twitch', { tabUrl });
      state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
    } else if (
      shouldKeepStreamerWhileDropProgresses({
        currentDrop: state.appState.currentDrop,
        lastProgressAdvanceAt: state.lastProgressAdvanceAt,
        now,
        effectiveThresholdMs: effectiveThreshold,
        reason: 'missing-context',
      })
    ) {
      logDebug('Stream context missing but drop progress is recent; keeping current streamer', {
        tabUrl,
        lastProgressAdvanceAt: state.lastProgressAdvanceAt,
        effectiveThresholdMs: effectiveThreshold,
      });
      state.invalidStreamChecks = 0;
      return;
    } else {
      state.invalidStreamChecks += 1;
    }
    if (state.invalidStreamChecks >= INVALID_STREAM_THRESHOLD) {
      if (now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
        return;
      }
      state.invalidStreamChecks = 0;
      if (opts?.onRotateStreamer) {
        await opts.onRotateStreamer(state, isStillOnTwitch ? 'missing-context' : 'navigated-away', {
          onOpenStreamer: opts?.onOpenStreamer,
          onSaveState: opts?.onSaveState,
          onSaveTimingState: opts?.onSaveTimingState,
          onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
          onSkipCurrentGame: opts?.onSkipCurrentGame,
        });
      }
    }
    return;
  }

  const sameChannel =
    !state.appState.activeStreamer || context.channelName === state.appState.activeStreamer.name;
  const hasDropsSignal = context.titleContainsDrops || context.hasDropsSignal;
  const selectedCategorySlug = opts?.onResolveCategorySlug
    ? normalizeToken(await opts.onResolveCategorySlug(state.appState.selectedGame))
    : '';
  const contextCategorySlug = normalizeToken(context.categorySlug);
  const sameGame =
    selectedCategorySlug.length === 0 || contextCategorySlug.length === 0
      ? true
      : selectedCategorySlug === contextCategorySlug;
  const campaignGone = haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
  const expectsDropsSignal =
    state.appState.currentDrop != null ||
    state.appState.pendingDrops.some((drop) => drop.dropType !== 'event-based') ||
    campaignGone;

  logDebug('Stream health inputs', {
    expectsDropsSignal,
    hasDropsSignal,
    campaignGone,
    currentDrop: !!state.appState.currentDrop,
    farmablePending: state.appState.pendingDrops.some((d) => d.dropType !== 'event-based'),
  });

  // A stream that expects but shows no Drops signal is likely the wrong channel; shorten its
  // stall window so we abandon it sooner instead of wasting the full threshold on it.
  const noDropsSignal = expectsDropsSignal && !hasDropsSignal;
  const stallThreshold = noDropsSignal
    ? Math.min(effectiveThreshold, NO_DROPS_SIGNAL_STALL_THRESHOLD_MS)
    : effectiveThreshold;
  const progressStalled =
    state.lastProgressAdvanceAt > 0 &&
    state.appState.currentDrop != null &&
    now - state.lastProgressAdvanceAt >= stallThreshold;

  const health = classifyStreamHealth({
    isLive: context.isLive,
    sameChannel,
    sameGame,
    hasDropsSignal,
    progressStalled,
    expectsDropsSignal,
  });

  // A live reading clears any pending offline confirmation streak.
  if (context.isLive) {
    state.offlineChecks = 0;
  }

  if (health.isHealthy) {
    state.invalidStreamChecks = 0;
    return;
  }

  if (health.forceImmediateRotation && health.reason === 'offline') {
    // Require consecutive offline readings before reloading — a single one is usually a
    // transient ad break or player re-render, not a real outage. Reloading then would be
    // the "tab reloads for no reason while the drop is still advancing" bug.
    state.offlineChecks += 1;
    if (state.offlineChecks < OFFLINE_CONFIRMATION_CHECKS) {
      logDebug('Offline reading not yet confirmed; keeping current streamer', {
        offlineChecks: state.offlineChecks,
        required: OFFLINE_CONFIRMATION_CHECKS,
        channel: state.appState.activeStreamer?.name ?? context.channelName,
      });
      return;
    }
    if (state.appState.recoveryReason === 'stalled-progress') {
      clearRecoveryState(state);
    }
    // Respect backoff when already in offline/open-failed recovery — prevents a
    // fast rotation loop when no replacement streamer is available (e.g. event-only
    // drops with no live channels).
    if (
      state.recoveryBackoffUntil > 0 &&
      now < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'offline' ||
        state.appState.recoveryReason === 'open-failed' ||
        state.appState.recoveryReason === 'no-streamers')
    ) {
      logDebug('Offline detected but in recovery backoff, skipping rotation', {
        recoveryReason: state.appState.recoveryReason,
        backoffRemainingMs: state.recoveryBackoffUntil - now,
      });
      return;
    }
    // If persistent recovery cycles are exhausted, skip the game rather than
    // looping forever — handles the case where no replacement streamer exists.
    if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
      logWarn('Offline recovery exhausted — skipping game', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        channel: state.appState.activeStreamer?.name ?? context.channelName,
      });
      if (opts?.onSkipCurrentGame) {
        await opts.onSkipCurrentGame();
      }
      return;
    }
    state.invalidStreamChecks = 0;
    logInfo('Offline stream detected, rotating immediately', {
      channel: state.appState.activeStreamer?.name ?? context.channelName,
      pageUrl: context.pageUrl,
    });
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'offline', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  if (
    shouldKeepStreamerWhileDropProgresses({
      currentDrop: state.appState.currentDrop,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      now,
      effectiveThresholdMs: effectiveThreshold,
      reason: health.reason,
    })
  ) {
    logDebug('Stream validation failed but drop progress is active; keeping current streamer', {
      reason: health.reason,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      effectiveThresholdMs: effectiveThreshold,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
    });
    state.invalidStreamChecks = 0;
    return;
  }

  if (health.reason === 'stalled-progress') {
    if (state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS) {
      logWarn('Stalled progress recovery exhausted — skipping game', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
        progress: state.appState.currentDrop?.progress ?? null,
        currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      });
      if (opts?.onSkipCurrentGame) {
        await opts.onSkipCurrentGame();
      }
      return;
    }
    if (
      state.recoveryBackoffUntil > 0 &&
      now < state.recoveryBackoffUntil &&
      state.appState.recoveryReason === 'stalled-progress'
    ) {
      return;
    }
    if (state.stalledRecoveryAttempts === 0) {
      // Attempt 1: in-place playback self-heal before giving up the streamer (handles a
      // stuck player or ad without losing a good Drops channel).
      state.stalledRecoveryAttempts = 1;
      state.lastRecoveryAttemptAt = now;
      state.recoveryBackoffUntil = now + STALLED_PROGRESS_RETRY_MS;
      applyRecoveryState(state, 'stalled-progress', state.recoveryBackoffUntil);
      logInfo('Attempting in-place playback self-heal before rotating', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
        recoveryBackoffUntil: state.recoveryBackoffUntil,
      });
      if (opts?.onAttemptPlaybackSelfHeal && tab.id) {
        await opts.onAttemptPlaybackSelfHeal(tab.id);
      }
      if (opts?.onSaveState) {
        await opts.onSaveState();
      }
      if (opts?.onSaveTimingState) {
        await opts.onSaveTimingState(state);
      }
      return;
    }
    // Attempts 2+: self-heal did not help. Before rotating, force a fresh campaign+inventory
    // poll — Twitch's claimed-rewards backend can lag behind its own notification/badge grant,
    // so a stale cached drop can look stalled when it is already done. If the refresh proves
    // progress (via detectRecoveryProof clearing stalledRecoveryAttempts) or the drop is gone,
    // skip rotating a perfectly good streamer for nothing.
    if (opts?.onForceRefreshDropsData) {
      await opts.onForceRefreshDropsData();
      if (state.stalledRecoveryAttempts === 0 || state.appState.currentDrop == null) {
        return;
      }
    }
    // Rotate to a DIFFERENT streamer. The stall threshold plus the self-heal backoff already
    // rate-limit this, so the generic rotation cooldown does not apply; advance the attempt
    // counter only when we actually rotate.
    state.stalledRecoveryAttempts = Math.min(
      MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      state.stalledRecoveryAttempts + 1,
    );
    state.lastRecoveryAttemptAt = now;
    state.recoveryBackoffUntil = 0;
    state.invalidStreamChecks = 0;
    applyRecoveryState(state, 'stalled-progress', null);
    logInfo('Drop progress stalled, rotating to a different streamer', {
      stalledRecoveryAttempts: state.stalledRecoveryAttempts,
      maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
      effectiveThresholdMs: stallThreshold,
      stalledForMs: now - state.lastProgressAdvanceAt,
    });
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  } else {
    state.invalidStreamChecks += health.invalidIncrement;
  }
  if (state.invalidStreamChecks < INVALID_STREAM_THRESHOLD) {
    return;
  }

  if (now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
    return;
  }

  state.invalidStreamChecks = 0;
  if (opts?.onRotateStreamer && health.reason) {
    await opts.onRotateStreamer(state, health.reason, {
      onOpenStreamer: opts?.onOpenStreamer,
      onSaveState: opts?.onSaveState,
      onSaveTimingState: opts?.onSaveTimingState,
      onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
      onSkipCurrentGame: opts?.onSkipCurrentGame,
    });
  }
}

export async function openBestStreamerForSelectedGame(
  state: ServiceWorkerState,
  callbacks: OpenBestStreamerCallbacks,
  deps: {
    dropMatchesSelectedGame: (drop: TwitchDrop, selected: TwitchGame) => boolean;
    isDropCompleted: (drop: TwitchDrop) => boolean;
    getGameDisplayLabel: (game: TwitchGame) => string;
    resolveCategorySlug: (game: TwitchGame) => Promise<string>;
    pickStreamerForPreferences: (
      candidates: TwitchStreamer[],
      prefs: StreamerSelectionPreferences,
      randomFn: () => number,
      filterApplied: boolean,
    ) => PickStreamerResult;
    normalizePreferredStreamerLanguage: (lang?: string | null) => string | null | undefined;
  },
): Promise<boolean> {
  if (!state.appState.selectedGame) {
    logWarn('Unable to open streamer: no selected game');
    return false;
  }

  // Pre-farming guard — skip streamer search if all drops for this game are completed
  const dropsForGame = state.cachedDropsSnapshot.filter((drop) =>
    deps.dropMatchesSelectedGame(drop, state.appState.selectedGame!),
  );
  if (dropsForGame.length > 0 && dropsForGame.every((d) => deps.isDropCompleted(d))) {
    logInfo('Skipping streamer: all drops completed', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
    });
    return false;
  }

  const resolvedSlug = await deps.resolveCategorySlug(state.appState.selectedGame);
  state.appState.selectedGame = {
    ...state.appState.selectedGame,
    categorySlug: resolvedSlug,
  };

  const streamers = await callbacks.onFetchDirectoryStreamersFromApi(
    state.appState.selectedGame,
    false,
    state.appState.preferredStreamerLanguage ?? '',
  );
  logDebug('Language filter applied to directory query', {
    language: state.appState.preferredStreamerLanguage ?? '',
    resultCount: streamers.length,
    filterApplied: streamers.languageFilterApplied,
  });
  if (!streamers.languageFilterApplied && state.appState.preferredStreamerLanguage) {
    logDebug('Language filter fallback: server-side filter returned 0 results, using unfiltered', {
      language: state.appState.preferredStreamerLanguage,
    });
  }

  // Per-campaign channel filtering — only use allowedChannels from PENDING campaigns
  const pendingDropsForGame = dropsForGame.filter((d) => !deps.isDropCompleted(d));
  const pendingCampaignIds = new Set(
    pendingDropsForGame.map((d) => d.campaignId).filter((id): id is string => Boolean(id)),
  );
  let allowed: string[] | null = null;
  let hasUnrestrictedCampaign = false;
  const restrictedChannels: string[] = [];
  pendingCampaignIds.forEach((cId) => {
    const channels = state.cachedCampaignChannelsMap[cId];
    if (channels == null) {
      hasUnrestrictedCampaign = true;
    } else {
      restrictedChannels.push(...channels);
    }
  });
  if (!hasUnrestrictedCampaign && restrictedChannels.length > 0) {
    allowed = [...new Set(restrictedChannels)];
  }
  // Fallback to game-level allowedChannels if no campaign mapping is available
  if (pendingCampaignIds.size === 0) {
    allowed = state.appState.selectedGame.allowedChannels ?? null;
  }

  logDebug('Streamer selection debug', {
    game: deps.getGameDisplayLabel(state.appState.selectedGame),
    pendingCampaignIds: Array.from(pendingCampaignIds),
    allowedChannels: allowed ?? 'null (any channel)',
    directoryStreamers: streamers.map((s) => s.name),
    directoryCount: streamers.length,
  });
  let candidates = filterStreamersByAllowedChannels(streamers, allowed);
  let selectionLanguageFilterApplied = streamers.languageFilterApplied;
  let selectionPreferences: StreamerSelectionPreferences = {
    mode: state.appState.streamerSelectionMode,
    preferredLanguage: state.appState.preferredStreamerLanguage,
  };
  let totalStreamersForNoAllowedWarning = streamers.length;
  if (allowed != null && allowed.length > 0) {
    const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
    logDebug('Filtered streamers by allowedChannels', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      beforeFilter: streamers.length,
      afterFilter: candidates.length,
      candidateNames: candidates.map((s) => s.name),
      rejected: streamers.filter((s) => !allowedSet.has(s.name.toLowerCase())).map((s) => s.name),
    });
  }

  if (candidates.length === 0 && allowed != null && allowed.length > 0 && streamers.languageFilterApplied) {
    const unfilteredStreamers = await callbacks.onFetchDirectoryStreamersFromApi(
      state.appState.selectedGame,
      false,
      '',
    );
    const unfilteredCandidates = filterStreamersByAllowedChannels(unfilteredStreamers, allowed);
    logDebug('Retrying streamer selection without preferred language', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      preferredLanguage: state.appState.preferredStreamerLanguage,
      beforeFilter: unfilteredStreamers.length,
      afterFilter: unfilteredCandidates.length,
      candidateNames: unfilteredCandidates.map((s) => s.name),
    });
    candidates = unfilteredCandidates;
    selectionLanguageFilterApplied = unfilteredStreamers.languageFilterApplied;
    totalStreamersForNoAllowedWarning = unfilteredStreamers.length;
    if (candidates.length > 0) {
      selectionPreferences = {
        mode: 'random',
        preferredLanguage: null,
      };
    }
  }

  if (candidates.length === 0 && allowed != null && allowed.length > 0 && streamers.length > 0) {
    logWarn('No allowed streamers are live for selected game', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      allowedChannels: allowed.length,
      totalStreamers: totalStreamersForNoAllowedWarning,
    });
  }
  // Skip the channel we just rotated away from, so a rotation actually changes streamer
  // instead of re-opening the same failing one. Never empty the pool over it. Only cleared
  // once a streamer is actually opened below, so a retry after an empty candidate pool
  // still avoids the same channel.
  const avoidName = state.avoidStreamerName;
  if (avoidName) {
    const withoutAvoided = candidates.filter(
      (candidate) => candidate.name.toLowerCase() !== avoidName.toLowerCase(),
    );
    if (withoutAvoided.length > 0 && withoutAvoided.length < candidates.length) {
      logDebug('Excluding previously failing streamer from selection', {
        avoid: avoidName,
        before: candidates.length,
        after: withoutAvoided.length,
      });
      candidates = withoutAvoided;
    }
  }
  const selection = deps.pickStreamerForPreferences(
    candidates,
    selectionPreferences,
    Math.random,
    selectionLanguageFilterApplied,
  );
  const streamer = selection.streamer;
  if (streamer) {
    logInfo('Opening selected streamer', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      selectionMode: selectionPreferences.mode,
      preferredLanguage: deps.normalizePreferredStreamerLanguage(selectionPreferences.preferredLanguage),
      preferredLanguageApplied: selection.preferredLanguageApplied,
      preferredLanguageMatches: selection.preferredLanguageMatches,
      activePoolSize: selection.activePoolSize,
      serverLanguageFilterApplied: selectionLanguageFilterApplied,
      streamer: streamer.name,
      viewers: streamer.viewerCount ?? null,
      broadcasterLanguage: streamer.broadcasterLanguage ?? null,
      candidates: candidates.length,
    });
    state.avoidStreamerName = null;
    await callbacks.onOpenForegroundChannel(streamer);
    return true;
  }

  logWarn('No streamer found for selected game', {
    game: deps.getGameDisplayLabel(state.appState.selectedGame),
    categorySlug: state.appState.selectedGame.categorySlug ?? null,
  });
  state.appState.activeStreamer = null;
  return false;
}
