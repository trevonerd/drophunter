import { dropMatchesGame } from '../shared/game-selection.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { encodeUnverifiableRewardKey } from './unverifiable-reward-key.ts';

export function hasCompleteIdentifiedRewardSet(
  game: TwitchGame,
  drops: readonly TwitchDrop[],
  requireRewardIdentity = false,
): boolean {
  const matching = drops.filter((drop) => dropMatchesGame(drop, game));
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
  const identifiedKeys = matching.map((drop) => encodeUnverifiableRewardKey(drop.id, drop.campaignId));
  return (
    identifiedKeys.every((key) => key !== null) &&
    new Set(identifiedKeys.filter((key) => key !== null)).size === expectedCount
  );
}
