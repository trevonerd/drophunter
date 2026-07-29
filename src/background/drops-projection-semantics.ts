import { dropMatchesGame, findMatchingGame, isSameGameIdentity } from '../shared/game-selection.ts';
import { isTwitchNativeReward, summarizeCampaignRewards } from '../shared/reward-semantics.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { encodeUnverifiableRewardKey, parseUnverifiableRewardKey } from './unverifiable-reward-key.ts';

export type DropsSnapshotProvenance = 'campaign-authoritative' | 'inventory-partial' | 'cached';

export function dropStateKey(drop: TwitchDrop): string {
  return `${drop.id}::${drop.campaignId ?? ''}`;
}

export function completedDropKeys(drops: TwitchDrop[]): Set<string> {
  return new Set(drops.map(dropStateKey));
}

function unverifiableRewardKey(drop: TwitchDrop): string | null {
  return encodeUnverifiableRewardKey(drop.id, drop.campaignId);
}

function hasExactIdentifiedRewardSet(
  game: TwitchGame,
  matching: TwitchDrop[],
  requireRewardIdentity = false,
): boolean {
  const campaignId = game.campaignId?.trim() ?? '';
  const expectedCount = game.dropCount;
  if (
    typeof expectedCount !== 'number' ||
    !Number.isInteger(expectedCount) ||
    expectedCount < 0 ||
    (requireRewardIdentity && (campaignId.length === 0 || expectedCount === 0)) ||
    matching.length !== expectedCount
  ) {
    return false;
  }
  const identifiedKeys = matching.map(unverifiableRewardKey);
  return (
    identifiedKeys.every((key) => key !== null) &&
    new Set(identifiedKeys.filter((key) => key !== null)).size === expectedCount
  );
}

export function hasCompleteIdentifiedRewardSet(
  game: TwitchGame,
  drops: readonly TwitchDrop[],
  requireRewardIdentity = false,
): boolean {
  const matching = drops.filter((drop) => dropMatchesGame(drop, game));
  return hasExactIdentifiedRewardSet(game, matching, requireRewardIdentity);
}

export function markDropUnverifiable(
  state: ServiceWorkerState,
  drop: TwitchDrop,
  markedAt = Date.now(),
): boolean {
  const key = unverifiableRewardKey(drop);
  if (
    key === null ||
    !isTwitchNativeReward(drop) ||
    drop.verificationState === 'verified' ||
    !Number.isFinite(drop.progress) ||
    drop.progress < 0 ||
    drop.progress > 100 ||
    !Number.isFinite(drop.currentMinutes) ||
    drop.currentMinutes < 0 ||
    !Number.isFinite(markedAt) ||
    markedAt < 0
  ) {
    return false;
  }

  state.unverifiableRewardsByKey[key] = {
    progress: drop.progress,
    currentMinutes: drop.currentMinutes,
    markedAt,
  };
  return true;
}

export function applyUnverifiableRewardMarker(state: ServiceWorkerState, drop: TwitchDrop): TwitchDrop {
  const key = unverifiableRewardKey(drop);
  return key !== null && state.unverifiableRewardsByKey[key]
    ? { ...drop, verificationState: 'unverifiable' }
    : drop;
}

export function clearUnverifiableRewardMarker(state: ServiceWorkerState, drop: TwitchDrop): boolean {
  const key = unverifiableRewardKey(drop);
  if (key === null || !state.unverifiableRewardsByKey[key]) {
    return false;
  }
  delete state.unverifiableRewardsByKey[key];
  return true;
}

function withoutUnverifiableState(drop: TwitchDrop): TwitchDrop {
  return drop.verificationState === 'unverifiable' ? { ...drop, verificationState: 'unassessed' } : drop;
}

function markerCampaignId(key: string): string | null {
  return parseUnverifiableRewardKey(key)?.campaignId ?? null;
}

function completeCampaignIds(snapshot: DropsSnapshot): Set<string> {
  const complete = new Set<string>();
  for (const game of snapshot.games) {
    const campaignId = game.campaignId?.trim() ?? '';
    if (campaignId.length === 0) {
      continue;
    }
    if (hasCompleteIdentifiedRewardSet(game, snapshot.drops)) {
      complete.add(campaignId);
    }
  }
  return complete;
}

export function isDropCampaignExpired(drop: TwitchDrop): boolean {
  if (!drop.endsAt) return false;
  const endsAtMs = new Date(drop.endsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
}

export function reconcileUnverifiableRewardMarkers(
  state: ServiceWorkerState,
  snapshot: DropsSnapshot,
  provenance: DropsSnapshotProvenance,
): TwitchDrop[] {
  state.unverifiableRewardsByKey ??= {};
  const acceptsProgressEvidence = provenance !== 'cached';
  for (const drop of snapshot.drops) {
    const key = unverifiableRewardKey(drop);
    if (key === null) {
      continue;
    }
    const marker = state.unverifiableRewardsByKey[key];
    if (!marker) {
      continue;
    }
    const hasForwardProgress =
      acceptsProgressEvidence &&
      (drop.progress > marker.progress || drop.currentMinutes > marker.currentMinutes);
    if (drop.verificationState === 'verified' || hasForwardProgress || isDropCampaignExpired(drop)) {
      delete state.unverifiableRewardsByKey[key];
    }
  }

  const presentKeys = new Set<string>();
  const reconciledDrops = snapshot.drops.map((drop) => {
    const key = unverifiableRewardKey(drop);
    if (key === null) {
      return withoutUnverifiableState(drop);
    }
    presentKeys.add(key);
    const marker = state.unverifiableRewardsByKey[key];
    if (!marker) {
      return withoutUnverifiableState(drop);
    }
    return applyUnverifiableRewardMarker(state, drop);
  });

  if (provenance === 'campaign-authoritative') {
    const campaignIds = new Set(
      snapshot.games
        .map((game) => game.campaignId?.trim() ?? '')
        .filter((campaignId) => campaignId.length > 0),
    );
    const completeCampaigns = completeCampaignIds(snapshot);
    for (const key of Object.keys(state.unverifiableRewardsByKey)) {
      const campaignId = markerCampaignId(key);
      if (
        campaignId !== null &&
        (!campaignIds.has(campaignId) || (completeCampaigns.has(campaignId) && !presentKeys.has(key)))
      ) {
        delete state.unverifiableRewardsByKey[key];
      }
    }
  }

  return reconciledDrops;
}

export function annotateGameCompletion(
  games: TwitchGame[],
  drops: TwitchDrop[],
  provenance: DropsSnapshotProvenance = 'cached',
): TwitchGame[] {
  return games.map((game) => {
    const matching = drops.filter((drop) => dropMatchesGame(drop, game));
    const hasCompleteRewardSet =
      provenance === 'campaign-authoritative' && hasCompleteIdentifiedRewardSet(game, drops);
    if (!hasCompleteRewardSet) {
      return game;
    }
    const rewardSummary = summarizeCampaignRewards(matching);
    return {
      ...game,
      rewardSummary,
      allDropsCompleted: rewardSummary.completion === 'all-acquired',
    };
  });
}

export function recomputeKnownCompleteGameSummary(game: TwitchGame, drops: TwitchDrop[]): TwitchGame {
  if (!game.rewardSummary) {
    return game;
  }
  const matching = drops.filter((drop) => dropMatchesGame(drop, game));
  if (!hasCompleteIdentifiedRewardSet(game, drops, true)) {
    return game;
  }
  const rewardSummary = summarizeCampaignRewards(matching);
  return {
    ...game,
    rewardSummary,
    allDropsCompleted: rewardSummary.completion === 'all-acquired',
  };
}

export function rememberInspectedCampaignSummary(state: ServiceWorkerState): void {
  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) {
    return;
  }
  const inspectedDrops = state.appState.allDrops.filter((drop) => dropMatchesGame(drop, selectedGame));
  if (inspectedDrops.length === 0 || !hasCompleteIdentifiedRewardSet(selectedGame, inspectedDrops)) {
    return;
  }

  const rewardSummary = summarizeCampaignRewards(inspectedDrops);
  const rememberedGame = {
    ...selectedGame,
    rewardSummary,
    allDropsCompleted: rewardSummary.completion === 'all-acquired',
  };
  const rememberMatchingCampaign = (game: TwitchGame) =>
    isSameGameIdentity(game, selectedGame) ? rememberedGame : game;
  state.appState.availableGames = state.appState.availableGames.map(rememberMatchingCampaign);
  state.appState.queue = state.appState.queue.map(rememberMatchingCampaign);
  state.appState.selectedGame = rememberedGame;
}

export function preserveGameCompletionSummaries(
  games: TwitchGame[],
  previousGames: TwitchGame[],
): TwitchGame[] {
  return games.map((game) => {
    const previous = findMatchingGame(game, previousGames);
    return previous
      ? {
          ...game,
          rewardSummary: previous.rewardSummary ?? game.rewardSummary,
          allDropsCompleted: previous.allDropsCompleted ?? game.allDropsCompleted,
        }
      : game;
  });
}
