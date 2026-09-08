import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { parseCampaignDrops } from '../src/background/twitch-api/campaign-drop-parsing.ts';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
} from '../src/background/twitch-api/claimed-rewards.ts';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
import { TwitchGqlTransport } from '../src/background/twitch-api/gql.ts';
import { buildInventoryDropMaps } from '../src/background/twitch-api/inventory-drops.ts';
import { buildConflictedRewardBenefitKeys } from '../src/background/twitch-api/parsing.ts';
import { isRewardAcquired, isRewardAutomatable } from '../src/shared/reward-semantics.ts';
import type { TwitchDrop } from '../src/types/index.ts';

const benefitId = '7f11cb5d-9749-11f1-b447-0a58a9feac02';
const reward: TwitchDrop = {
  id: '59bac079-9749-11f1-a04f-0a58a9feac02',
  campaignId: '90589949-1d2e-4161-8def-3aee51e1f721',
  gameId: 'campaign-90589949-1d2e-4161-8def-3aee51e1f721',
  gameName: 'Resonance: A Plague Tale Legacy',
  name: 'Resonance Minotaur',
  imageUrl: '',
  benefitIds: [benefitId],
  rewardDistributionTypes: ['BADGE'],
  rewardKind: 'twitch-badge',
  verificationState: 'unassessed',
  acquisitionMethod: 'watch-time',
  claimed: false,
  claimable: false,
  currentMinutes: 0,
  progress: 0,
  requiredMinutes: 60,
  remainingMinutes: 60,
  startsAt: '2026-08-26T16:00:00.000Z',
  endsAt: '2026-09-23T15:59:59.999Z',
};
const award = {
  id: benefitId,
  name: reward.name,
  game: null,
  lastAwardedAt: '2026-09-08T11:49:11.448Z',
};
const session = { oauthToken: 'fixture', userId: 'fixture', deviceId: 'fixture', uuid: 'fixture' };

function inventoryWith(record: object) {
  return { dropCampaignsInProgress: [], gameEventDrops: [record] };
}

afterEach(() => mock.restore());

describe('Twitch-native award without a game association', () => {
  for (const kind of ['twitch-badge', 'twitch-emote'] as const) {
    test(`inventory refresh recognizes an awarded ${kind} despite zero watch progress`, async () => {
      spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
        currentUser: { inventory: inventoryWith(award) },
      });
      const snapshot = await new TwitchApiClient(session).fetchInventorySnapshot([
        {
          ...reward,
          rewardKind: kind,
          rewardDistributionTypes: [kind === 'twitch-badge' ? 'BADGE' : 'EMOTE'],
        },
      ]);
      const drop = snapshot.drops[0];
      expect(drop).toMatchObject({
        verificationState: 'verified',
        claimed: true,
        progress: 100,
        claimable: false,
      });
      expect(drop && isRewardAcquired(drop)).toBe(true);
      expect(drop && isRewardAutomatable(drop)).toBe(false);
    });
  }

  test('full campaign parsing accepts the same unique, timestamped native award', () => {
    const inventory = inventoryWith(award);
    const game = { id: reward.gameId, name: reward.gameName, campaignId: reward.campaignId, imageUrl: '' };
    const drops = parseCampaignDrops(
      {
        id: reward.campaignId,
        startAt: reward.startsAt,
        endAt: reward.endsAt,
        timeBasedDrops: [
          {
            id: reward.id,
            name: reward.name,
            requiredMinutesWatched: 60,
            self: { currentMinutesWatched: 0, isClaimed: false },
            benefitEdges: [{ benefit: { id: benefitId, distributionType: 'BADGE' } }],
          },
        ],
      },
      game,
      buildInventoryDropMaps(inventory),
      buildClaimedRewardLookup(inventory),
      buildGlobalClaimedRewardEntry(inventory),
      buildConflictedRewardBenefitKeys([
        { gameName: game.name, campaignIdentity: game.campaignId ?? '', benefitIds: [benefitId] },
      ]),
    );
    expect(drops[0]).toMatchObject({ verificationState: 'verified', claimed: true, progress: 100 });
  });

  test.each([
    { ...award, lastAwardedAt: undefined },
    { ...award, lastAwardedAt: 'invalid' },
    { ...award, lastAwardedAt: '2026-08-01T00:00:00Z' },
    { ...award, lastAwardedAt: reward.endsAt },
    { ...award, game: { displayName: 'Another game' } },
    { ...award, game: {} },
    { ...award, game: undefined },
    { ...award, id: 'another-benefit' },
  ])('does not invent acquisition from ambiguous or mismatched evidence %j', async (record) => {
    spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
      currentUser: { inventory: inventoryWith(record) },
    });
    const snapshot = await new TwitchApiClient(session).fetchInventorySnapshot([reward]);
    expect(snapshot.drops[0]).toMatchObject({ verificationState: 'unassessed', claimed: false, progress: 0 });
  });

  for (const gameName of [reward.gameName, 'Another game']) {
    test(`does not attribute a game-less award to competing campaigns (${gameName})`, async () => {
      spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
        currentUser: { inventory: inventoryWith(award) },
      });
      const snapshot = await new TwitchApiClient(session).fetchInventorySnapshot([
        reward,
        { ...reward, id: 'sibling-reward', campaignId: 'sibling-campaign', gameName },
      ]);
      expect(snapshot.drops.every((drop) => !drop.claimed && drop.verificationState === 'unassessed')).toBe(
        true,
      );
    });
  }

  test('does not apply the native fallback to in-game rewards', async () => {
    spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
      currentUser: { inventory: inventoryWith(award) },
    });
    const snapshot = await new TwitchApiClient(session).fetchInventorySnapshot([
      { ...reward, rewardKind: 'in-game', rewardDistributionTypes: ['DIRECT_ENTITLEMENT'] },
    ]);
    expect(snapshot.drops[0]?.claimed).toBe(false);
  });
});
