import { describe, expect, test } from 'bun:test';
import {
  type CampaignPriorityCandidate,
  insertFavoriteCampaignByDeadline,
  orderCampaignCandidates,
} from '../src/background/campaign-priority.ts';
import type { TwitchGame } from '../src/types/index.ts';

function game(campaignId: string, endsAt: string, gameId = campaignId): TwitchGame {
  return {
    id: gameId,
    name: `Game ${gameId}`,
    campaignName: `Campaign ${campaignId}`,
    campaignId,
    endsAt,
    imageUrl: '',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function candidate(
  campaignId: string,
  endsAt: string,
  eligibleStreamerCount: number,
  hasStartedReward = false,
  gameId = campaignId,
): CampaignPriorityCandidate {
  return { game: game(campaignId, endsAt, gameId), eligibleStreamerCount, hasStartedReward };
}

describe('CampaignPriorityPolicy', () => {
  test('ending-soonest uses progress, availability, then campaign id as stable tie-breakers', () => {
    const candidates = [
      candidate('delta', '2026-08-03T14:00:00.000Z', 2),
      candidate('charlie', '2026-08-03T12:00:00.000Z', 5),
      candidate('bravo', '2026-08-03T12:00:00.000Z', 1),
      candidate('alpha', '2026-08-03T12:00:00.000Z', 1, true),
    ];

    const ordered = orderCampaignCandidates(candidates, {
      mode: 'ending-soonest',
      scope: 'all',
      favoriteGameIds: new Set(),
      priorityList: [],
    });

    expect(ordered.map((entry) => entry.game.campaignId)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(ordered[0]?.positionReason).toContain('ends first');
  });

  test('lowest-availability prioritizes fewer eligible channels before expiry and progress', () => {
    const candidates = [
      candidate('many', '2026-08-03T10:00:00.000Z', 9, true),
      candidate('few-late', '2026-08-03T14:00:00.000Z', 1),
      candidate('few-early', '2026-08-03T12:00:00.000Z', 1),
    ];

    const ordered = orderCampaignCandidates(candidates, {
      mode: 'lowest-availability',
      scope: 'all',
      favoriteGameIds: new Set(),
      priorityList: [],
    });

    expect(ordered.map((entry) => entry.game.campaignId)).toEqual(['few-early', 'few-late', 'many']);
    expect(ordered[0]?.positionReason).toContain('eligible live channel');
  });

  test('priority-list-only includes only the campaign-aware visible queue order', () => {
    const first = candidate('campaign-a', '2026-08-03T14:00:00.000Z', 3, false, 'same-game');
    const second = candidate('campaign-b', '2026-08-03T12:00:00.000Z', 1, false, 'same-game');
    const omitted = candidate('campaign-c', '2026-08-03T11:00:00.000Z', 1);

    const ordered = orderCampaignCandidates([first, second, omitted], {
      mode: 'priority-list-only',
      scope: 'all',
      favoriteGameIds: new Set(),
      priorityList: [second.game, first.game],
    });

    expect(ordered.map((entry) => entry.game.campaignId)).toEqual(['campaign-b', 'campaign-a']);
    expect(ordered.every((entry) => entry.positionReason.includes('priority list'))).toBe(true);
  });

  test('favorites-only filters by Twitch category id without collapsing campaigns', () => {
    const ordered = orderCampaignCandidates(
      [
        candidate('campaign-a', '2026-08-03T12:00:00.000Z', 1, false, 'favorite-game'),
        candidate('campaign-b', '2026-08-03T13:00:00.000Z', 2, false, 'favorite-game'),
        candidate('campaign-c', '2026-08-03T11:00:00.000Z', 1, false, 'other-game'),
      ],
      {
        mode: 'ending-soonest',
        scope: 'favorites-only',
        favoriteGameIds: new Set(['favorite-game']),
        priorityList: [],
      },
    );

    expect(ordered.map((entry) => entry.game.campaignId)).toEqual(['campaign-a', 'campaign-b']);
  });

  test('favorite insertion keeps existing relative order and inserts before a later expiry', () => {
    const existing = [
      game('first', '2026-08-03T10:00:00.000Z'),
      game('second', '2026-08-03T14:00:00.000Z'),
      game('third', '2026-08-03T16:00:00.000Z'),
    ];

    const result = insertFavoriteCampaignByDeadline(existing, game('favorite', '2026-08-03T13:00:00.000Z'));

    expect(result.queue.map((entry) => entry.campaignId)).toEqual(['first', 'favorite', 'second', 'third']);
    expect(result.position).toBe(2);
  });
});
