import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey, isSameGameIdentity } from '../shared/game-selection.ts';
import type { CampaignAvailability } from '../types/index.ts';
import { discoverEligibleStreamers } from './eligible-streamer-discovery.ts';
import type { FarmingAutomationFailureReason } from './farming-automation-contracts.ts';
import {
  cloneFarmingAutomationGame,
  type FarmingAutomationDirectoryCacheEntry,
} from './farming-automation-gates.ts';
import { reconcileFarmingAutomationSnapshot } from './farming-automation-reconciliation.ts';
import type {
  FarmingAutomationTwitchAdapter,
  FarmingAutomationTwitchSnapshot,
} from './farming-automation-twitch.ts';
import { FarmingAutomationSessionMissingError } from './farming-automation-twitch.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type FarmingAutomationDiscoveryResult =
  | {
      readonly kind: 'ready';
      readonly snapshot: FarmingAutomationTwitchSnapshot;
      readonly directories: ReadonlyMap<string, FarmingAutomationDirectoryCacheEntry>;
      readonly availability: Readonly<Record<string, CampaignAvailability>>;
      readonly directoryFailures: ReadonlySet<string>;
    }
  | {
      readonly kind: 'failed';
      readonly reason: Extract<
        FarmingAutomationFailureReason,
        'drops-refresh-failed' | 'twitch-session-missing'
      >;
    }
  | { readonly kind: 'cancelled' };

export async function discoverFarmingAutomationCandidates(
  twitch: FarmingAutomationTwitchAdapter,
  language: string,
  now: number,
  state?: ServiceWorkerState,
  isCurrent: () => boolean = () => true,
): Promise<FarmingAutomationDiscoveryResult> {
  const initialUserId = state?.twitchSessionCache?.userId ?? null;
  let expectedUserId = initialUserId;
  let observedCacheUserId = initialUserId;
  const stillCurrent = () => {
    if (!isCurrent()) return false;
    if (!state) return true;
    const currentUserId = state.twitchSessionCache?.userId ?? null;
    if (observedCacheUserId !== null) return currentUserId === observedCacheUserId;
    if (currentUserId === null) return true;
    observedCacheUserId = currentUserId;
    return expectedUserId === null || currentUserId === expectedUserId;
  };
  let refreshed: Awaited<ReturnType<FarmingAutomationTwitchAdapter['refresh']>>;
  try {
    refreshed = await twitch.refresh();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'failed', reason: 'drops-refresh-failed' };
  }
  if (!stillCurrent()) return { kind: 'cancelled' };
  if (refreshed.kind === 'session-missing') {
    return { kind: 'failed', reason: 'twitch-session-missing' };
  }
  if (initialUserId && refreshed.sessionUserId && refreshed.sessionUserId !== initialUserId) {
    return { kind: 'cancelled' };
  }
  expectedUserId = refreshed.sessionUserId ?? state?.twitchSessionCache?.userId ?? initialUserId;
  if (observedCacheUserId && expectedUserId && observedCacheUserId !== expectedUserId) {
    return { kind: 'cancelled' };
  }
  if (!stillCurrent()) return { kind: 'cancelled' };

  let snapshot = state ? reconcileFarmingAutomationSnapshot(refreshed.snapshot, state) : refreshed.snapshot;
  const directories = new Map<string, FarmingAutomationDirectoryCacheEntry>();
  const availability: Record<string, CampaignAvailability> = {};
  const directoryFailures = new Set<string>();
  let sessionMissing = false;
  const farmableGames = snapshot.games.filter((game) => {
    const rejectionReason =
      campaignRejectionReason(cloneFarmingAutomationGame(game), now) ??
      (game.rewardSummary?.completion === 'farmable' ? null : 'unclassified');
    if (rejectionReason === null) return true;
    logDebug('Campaign rejected before automatic queue planning', {
      campaignId: game.campaignId,
      completion: game.rewardSummary?.completion,
      rejectionReason,
    });
    return false;
  });
  let freshRefresh: ReturnType<FarmingAutomationTwitchAdapter['refresh']> | null = null;
  const directoryResponses = await Promise.all(
    farmableGames.map(async (normalized) => {
      const game = cloneFarmingAutomationGame(normalized);
      const discovered = await discoverEligibleStreamers({
        game,
        language,
        isCurrent: stillCurrent,
        fetchDirectory: async (candidate, preferredLanguage) => {
          const directory = await twitch.fetchDirectory(candidate, preferredLanguage);
          if (directory.kind === 'session-missing') throw new FarmingAutomationSessionMissingError();
          return {
            streamers: [...directory.streamers],
            languageFilterApplied: directory.languageFilterApplied,
          };
        },
        probeChannel: twitch.probeStreamInfo ?? (async () => ({ kind: 'unavailable' as const })),
        refresh: async () => {
          freshRefresh ??= twitch.refresh(false, { requireFreshCompleteSnapshot: true });
          let fresh: Awaited<ReturnType<typeof twitch.refresh>>;
          try {
            fresh = await freshRefresh;
          } catch {
            return { kind: 'unavailable' as const };
          }
          if (fresh?.kind === 'session-missing') {
            return { kind: 'unavailable' as const, cause: new FarmingAutomationSessionMissingError() };
          }
          if (fresh?.kind !== 'ready') return { kind: 'unavailable' as const };
          if (!stillCurrent() || (expectedUserId && fresh.sessionUserId !== expectedUserId)) {
            return { kind: 'unavailable' as const };
          }
          snapshot = state ? reconcileFarmingAutomationSnapshot(fresh.snapshot, state) : fresh.snapshot;
          const current = snapshot.games
            .map(cloneFarmingAutomationGame)
            .find((candidate) => isSameGameIdentity(candidate, game));
          return current ? { kind: 'ready' as const, game: current } : { kind: 'unavailable' as const };
        },
      });
      return { game, discovered } as const;
    }),
  );
  if (!stillCurrent()) return { kind: 'cancelled' };
  for (const response of directoryResponses) {
    const { game } = response;
    const finalGame = snapshot.games
      .map(cloneFarmingAutomationGame)
      .find((candidate) => isSameGameIdentity(candidate, game));
    if (
      !finalGame ||
      campaignRejectionReason(finalGame, now) !== null ||
      finalGame.rewardSummary?.completion !== 'farmable'
    ) {
      directoryFailures.add(gameKey(game));
      continue;
    }
    let discovered = response.discovered;
    const candidateFieldsChanged =
      JSON.stringify([
        game.allowedChannels ?? null,
        game.categoryId ?? null,
        game.categorySlug ?? null,
        game.name,
      ]) !==
      JSON.stringify([
        finalGame.allowedChannels ?? null,
        finalGame.categoryId ?? null,
        finalGame.categorySlug ?? null,
        finalGame.name,
      ]);
    if (freshRefresh && candidateFieldsChanged) {
      discovered = await discoverEligibleStreamers({
        game: finalGame,
        language,
        isCurrent: stillCurrent,
        fetchDirectory: async (candidate, preferredLanguage) => {
          const directory = await twitch.fetchDirectory(candidate, preferredLanguage);
          if (directory.kind === 'session-missing') throw new FarmingAutomationSessionMissingError();
          return {
            streamers: [...directory.streamers],
            languageFilterApplied: directory.languageFilterApplied,
          };
        },
        probeChannel: twitch.probeStreamInfo ?? (async () => ({ kind: 'unavailable' as const })),
        refresh: async () => {
          const fresh = await freshRefresh;
          if (fresh?.kind === 'session-missing') {
            return { kind: 'unavailable' as const, cause: new FarmingAutomationSessionMissingError() };
          }
          if (fresh?.kind !== 'ready') return { kind: 'unavailable' as const };
          const campaign = snapshot.games
            .map(cloneFarmingAutomationGame)
            .find((candidate) => isSameGameIdentity(candidate, finalGame));
          return campaign ? { kind: 'ready' as const, game: campaign } : { kind: 'unavailable' as const };
        },
      });
    }
    if (discovered.kind === 'unavailable' || discovered.kind === 'cancelled') {
      if (
        discovered.kind === 'unavailable' &&
        discovered.cause instanceof FarmingAutomationSessionMissingError
      ) {
        sessionMissing = true;
      }
      directoryFailures.add(gameKey(game));
      continue;
    }
    const streamers = discovered.kind === 'ready' ? discovered.streamers : [];
    directories.set(gameKey(finalGame), {
      streamers,
      languageFilterApplied: discovered.kind === 'ready' ? discovered.languageFilterApplied : false,
      preferredLanguageFallbackApplied:
        discovered.kind === 'ready' && discovered.preferredLanguageFallbackApplied,
    });
    availability[gameKey(finalGame)] = { eligibleStreamerCount: streamers.length, updatedAt: now };
  }
  return sessionMissing
    ? { kind: 'failed', reason: 'twitch-session-missing' }
    : { kind: 'ready', snapshot, directories, availability, directoryFailures };
}
