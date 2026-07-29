import { describe, expect, test } from 'bun:test';
import {
  isRewardAcquired,
  isRewardAutomatable,
  isTwitchNativeReward,
  summarizeCampaignRewards,
} from '../src/shared/reward-semantics.ts';
import type { TwitchDrop } from '../src/types/index.ts';

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

describe('isTwitchNativeReward', () => {
  test('recognizes Twitch badges', () => {
    // Given
    const drop = createDrop({ rewardKind: 'twitch-badge' });

    // When
    const result = isTwitchNativeReward(drop);

    // Then
    expect(result).toBe(true);
  });

  test('recognizes Twitch emotes', () => {
    // Given
    const drop = createDrop({ rewardKind: 'twitch-emote' });

    // When
    const result = isTwitchNativeReward(drop);

    // Then
    expect(result).toBe(true);
  });

  test('does not classify unknown rewards as Twitch-native', () => {
    // Given
    const drop = createDrop({ rewardKind: 'unknown' });

    // When
    const result = isTwitchNativeReward(drop);

    // Then
    expect(result).toBe(false);
  });
});

describe('isRewardAcquired', () => {
  test('requires verification for a Twitch-native reward reported at 100 percent', () => {
    // Given
    const drop = createDrop({
      progress: 100,
      claimed: true,
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    });

    // When
    const result = isRewardAcquired(drop);

    // Then
    expect(result).toBe(false);
  });

  test('treats a verified Twitch-native reward as acquired', () => {
    // Given
    const drop = createDrop({
      progress: 100,
      claimed: true,
      rewardKind: 'twitch-emote',
      verificationState: 'verified',
    });

    // When
    const result = isRewardAcquired(drop);

    // Then
    expect(result).toBe(true);
  });

  test('keeps existing completion compatibility for an ordinary reward', () => {
    // Given
    const drop = createDrop({ progress: 100, claimable: false, rewardKind: 'in-game' });

    // When
    const result = isRewardAcquired(drop);

    // Then
    expect(result).toBe(true);
  });
});

describe('isRewardAutomatable', () => {
  test('keeps a fresh Twitch badge on the normal farming path', () => {
    // Given
    const drop = createDrop({ progress: 0, rewardKind: 'twitch-badge' });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(true);
  });

  test('keeps a fresh Twitch emote on the normal farming path', () => {
    // Given
    const drop = createDrop({ progress: 0, rewardKind: 'twitch-emote' });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(true);
  });

  test('keeps an unknown reward shape on the normal farming path', () => {
    // Given
    const drop = createDrop({ acquisitionMethod: 'unknown', rewardKind: 'unknown' });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(true);
  });

  test('does not automate subscription-gated rewards', () => {
    // Given
    const drop = createDrop({ acquisitionMethod: 'subscription' });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(false);
  });

  test('does not automate reserved other-event rewards', () => {
    // Given
    const drop = createDrop({ acquisitionMethod: 'other-event' });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(false);
  });

  test('does not automate an unverifiable Twitch-native reward', () => {
    // Given
    const drop = createDrop({
      rewardKind: 'twitch-badge',
      verificationState: 'unverifiable',
    });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(false);
  });

  test('does not automate a claimed Twitch-native reward without verification evidence', () => {
    // Given
    const drop = createDrop({
      progress: 100,
      claimed: true,
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    });

    // When
    const result = isRewardAutomatable(drop);

    // Then
    expect(result).toBe(false);
  });
});

describe('summarizeCampaignRewards', () => {
  test('reports all-acquired only when every reward is acquired', () => {
    // Given
    const drops = [
      createDrop({ id: 'ordinary', progress: 100, claimed: true }),
      createDrop({
        id: 'native',
        progress: 100,
        claimed: true,
        rewardKind: 'twitch-emote',
        verificationState: 'verified',
      }),
    ];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({ completion: 'all-acquired', remainderReasons: [] });
  });

  test('reports farmable while any pending reward remains automatable', () => {
    // Given
    const drops = [
      createDrop({ id: 'subscription', acquisitionMethod: 'subscription' }),
      createDrop({ id: 'fresh-badge', rewardKind: 'twitch-badge' }),
    ];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({ completion: 'farmable', remainderReasons: [] });
  });

  test('reports a subscription-only remainder', () => {
    // Given
    const drops = [createDrop({ acquisitionMethod: 'subscription' })];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required'],
    });
  });

  test('reports an unverifiable Twitch-only remainder', () => {
    // Given
    const drops = [createDrop({ rewardKind: 'twitch-emote', verificationState: 'unverifiable' })];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    });
  });

  test('reports claimed Twitch-native observations without proof as unverifiable remainders', () => {
    // Given
    const drops = [
      createDrop({
        progress: 100,
        claimed: true,
        rewardKind: 'twitch-emote',
        verificationState: 'unassessed',
      }),
    ];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    });
  });

  test('orders subscription before unverifiable Twitch remainders', () => {
    // Given
    const drops = [
      createDrop({ rewardKind: 'twitch-badge', verificationState: 'unverifiable' }),
      createDrop({ acquisitionMethod: 'subscription' }),
    ];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    });
  });

  test('handles reserved other-event rewards without inventing a remainder reason', () => {
    // Given
    const drops = [createDrop({ acquisitionMethod: 'other-event' })];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({ completion: 'farming-complete', remainderReasons: [] });
  });

  test('does not synthesize all-acquired for an empty reward set', () => {
    // Given
    const drops: TwitchDrop[] = [];

    // When
    const summary = summarizeCampaignRewards(drops);

    // Then
    expect(summary).toEqual({ completion: 'farmable', remainderReasons: [] });
  });
});
