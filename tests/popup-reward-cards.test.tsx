import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applyUnverifiableRewardMarker,
  markDropUnverifiable,
} from '../src/background/drops-projection-semantics';
import { createServiceWorkerState } from '../src/background/runtime-state';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
  buildInventoryDropMaps,
  parseCampaignDrops,
} from '../src/background/twitch-api/client';
import { CompactDropCard } from '../src/popup/components/DropCard';
import { RewardList } from '../src/popup/components/RewardList';
import { drop, game } from './fixtures/popup-reward';

test('subscription reward card uses the exact redemption copy', () => {
  // Given
  const subscriptionReward = drop({
    acquisitionMethod: 'subscription',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={subscriptionReward} />);

  // Then
  expect(markup).toContain('Subscription required');
  expect(markup).toContain('Subscribe to redeem this reward');
  expect(markup).toContain('class="mt-1 text-[10px] text-orange-400"');
  expect(markup).not.toContain('opacity-60');
  expect(markup).not.toContain('text-orange-400/70');
  expect(markup).not.toContain('Sub only');
});

test('claimed Twitch-native parser observation stays unverifiable after marker projection', () => {
  // Given
  const campaign = {
    id: 'campaign-unverifiable-badge',
    timeBasedDrops: [
      {
        id: 'unverifiable-badge-drop',
        name: 'Twitch Badge Reward',
        requiredMinutesWatched: 60,
        benefitEdges: [
          {
            benefit: {
              id: 'unverifiable-badge-benefit',
              name: 'Twitch Badge Reward',
              distributionType: 'BADGE',
            },
          },
        ],
      },
    ],
  };
  const inventory = {
    dropCampaignsInProgress: [
      {
        id: campaign.id,
        timeBasedDrops: [
          {
            id: 'unverifiable-badge-drop',
            requiredMinutesWatched: 60,
            self: { currentMinutesWatched: 60, isClaimed: true, isClaimable: false },
          },
        ],
      },
    ],
    gameEventDrops: [],
  };
  const parsedRewards = parseCampaignDrops(
    campaign,
    game({ campaignId: campaign.id }),
    buildInventoryDropMaps(inventory),
    buildClaimedRewardLookup(inventory),
    buildGlobalClaimedRewardEntry(inventory),
  );
  const parsedReward = parsedRewards[0];
  if (!parsedReward) {
    throw new TypeError('Expected the Twitch badge parser fixture to produce one reward');
  }
  const state = createServiceWorkerState();
  const markerRecorded = markDropUnverifiable(state, parsedReward, 123_456);
  const unverifiableReward = applyUnverifiableRewardMarker(state, parsedReward);

  expect(markerRecorded).toBe(true);
  expect(unverifiableReward).toMatchObject({
    claimed: true,
    progress: 100,
    remainingMinutes: 0,
    rewardKind: 'twitch-badge',
    verificationState: 'unverifiable',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={unverifiableReward} />);

  // Then
  expect(markup).toContain('Unverifiable');
  expect(markup).toContain('100%');
  expect(markup).toContain('Acquisition could not be verified on Twitch');
  expect(markup).not.toContain('>Claimed<');
});

test('claimed Twitch-native observation without timestamp proof renders as unverifiable', () => {
  const claimedUnassessed = drop({
    claimed: true,
    progress: 100,
    rewardKind: 'twitch-badge',
    verificationState: 'unassessed',
  });

  const markup = renderToStaticMarkup(<CompactDropCard drop={claimedUnassessed} />);

  expect(markup).toContain('Unverifiable');
  expect(markup).not.toContain('>Claimed<');
  expect(markup).not.toContain('ETA');
});

test('verified Twitch-native reward card retains the acquired presentation', () => {
  // Given
  const verifiedReward = drop({
    claimed: true,
    progress: 100,
    status: 'completed',
    rewardKind: 'twitch-badge',
    verificationState: 'verified',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={verifiedReward} />);

  // Then
  expect(markup).toContain('>Claimed<');
  expect(markup).toContain('100%');
  expect(markup).not.toContain('Unverifiable');
});

test('ordinary reward cards retain claimable, active, and ready controls', () => {
  // Given
  const claimableReward = drop({ claimable: true, progress: 100 });
  const activeReward = drop({ status: 'active', progress: 42, remainingMinutes: 18 });
  const pendingReward = drop();

  // When
  const markup = [claimableReward, activeReward, pendingReward]
    .map((reward) => renderToStaticMarkup(<CompactDropCard drop={reward} />))
    .join('\n');

  // Then
  expect(markup).toContain('>Claimable<');
  expect(markup).toContain('dh-progress-fill--claimable');
  expect(markup).toContain('>Active<');
  expect(markup).toContain('42%');
  expect(markup).toContain('ETA 18m');
  expect(markup).toContain('>Ready<');
  expect(markup).not.toContain('>Pending<');
});

test('reward progress exposes native progressbar semantics', () => {
  const markup = renderToStaticMarkup(
    <CompactDropCard drop={drop({ name: 'Long Watch Reward', progress: 42, status: 'active' })} />,
  );

  expect(markup).toContain('role="progressbar"');
  expect(markup).toContain('aria-label="Long Watch Reward progress"');
  expect(markup).toContain('aria-valuemin="0"');
  expect(markup).toContain('aria-valuemax="100"');
  expect(markup).toContain('aria-valuenow="42"');
});

test('completed rewards use an accessible structured disclosure', () => {
  const markup = renderToStaticMarkup(
    <RewardList
      pendingDrops={[]}
      completedDrops={[
        drop({ id: 'one', name: 'First Reward', claimed: true, progress: 100 }),
        drop({ id: 'two', name: 'Second Reward', claimed: true, progress: 100 }),
      ]}
      rewardsLoading={false}
      syncLoading={false}
      claimableCount={0}
    />,
  );

  expect(markup).toContain('<details');
  expect(markup).toContain('<summary');
  expect(markup).toContain('data-completed-reward-count="2"');
  expect(markup).toContain('<ul');
  expect(markup).toContain('<li');
});

