import { describe, expect, test } from 'bun:test';
import {
  type AutoStartCandidate,
  type AutoStartCoordinatorState,
  createAutoStartCoordinator,
} from '../src/background/auto-start-coordinator.ts';
import type { TwitchGame } from '../src/types/index.ts';

function game(campaignId: string, endsAt = '2030-08-03T14:00:00.000Z', gameId = campaignId): TwitchGame {
  return {
    id: gameId,
    name: `Game ${gameId}`,
    campaignId,
    campaignName: `Campaign ${campaignId}`,
    endsAt,
    imageUrl: '',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function candidate(
  campaignId: string,
  endsAt = '2030-08-03T14:00:00.000Z',
  overrides: Partial<AutoStartCandidate> = {},
): AutoStartCandidate {
  return {
    game: game(campaignId, endsAt),
    eligibleStreamerCount: 1,
    hasStartedReward: false,
    hasFarmableReward: true,
    isActive: true,
    isFavorite: true,
    ...overrides,
  };
}

function state(overrides: Partial<AutoStartCoordinatorState> = {}): AutoStartCoordinatorState {
  return {
    autoStartFavoriteGames: true,
    notificationsEnabled: true,
    isRunning: false,
    isPaused: false,
    selectedGame: null,
    manualWatchActive: false,
    autoStartSnoozed: false,
    twitchSessionValid: true,
    ...overrides,
  };
}

function makeCoordinator(
  initialState: AutoStartCoordinatorState,
  candidates: readonly AutoStartCandidate[],
  options: {
    readonly refreshDrops?: () => Promise<void>;
    readonly discoverCandidates?: () => Promise<readonly AutoStartCandidate[]>;
    readonly onRankedCampaigns?: (ranked: readonly AutoStartCandidate[]) => Promise<void>;
    readonly startFarming?: (campaign: TwitchGame, context: { readonly preempted: boolean }) => Promise<void>;
    readonly hasNotificationPermission?: () => Promise<boolean>;
  } = {},
) {
  let currentState = initialState;
  return {
    coordinator: createAutoStartCoordinator({
      getState: () => currentState,
      refreshDrops: options.refreshDrops ?? (async () => undefined),
      discoverCandidates: options.discoverCandidates ?? (async () => candidates),
      onRankedCampaigns: options.onRankedCampaigns ?? (async () => undefined),
      startFarming: options.startFarming ?? (async () => undefined),
      hasNotificationPermission: options.hasNotificationPermission ?? (async () => true),
      now: () => Date.parse('2030-08-03T10:00:00.000Z'),
    }),
    setState: (next: AutoStartCoordinatorState) => {
      currentState = next;
    },
  };
}

describe('AutoStartCoordinator', () => {
  test('starts the highest-ranked eligible campaign after a refresh', async () => {
    const started: string[] = [];
    const { coordinator } = makeCoordinator(
      state(),
      [candidate('later', '2030-08-03T16:00:00.000Z'), candidate('sooner')],
      {
        startFarming: async (campaign) => {
          started.push(campaign.campaignId ?? campaign.id);
        },
      },
    );

    const result = await coordinator.evaluate('browser-start');

    expect(result).toMatchObject({ started: true, preempted: false });
    expect(result.campaign?.campaignId).toBe('sooner');
    expect(started).toEqual(['sooner']);
  });

  test('coalesces concurrent evaluations into one refresh and one start', async () => {
    let refreshCount = 0;
    let startCount = 0;
    let releaseRefresh: (() => void) | undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { coordinator } = makeCoordinator(state(), [candidate('one')], {
      refreshDrops: async () => {
        refreshCount += 1;
        await refreshBarrier;
      },
      startFarming: async () => {
        startCount += 1;
      },
    });

    const first = coordinator.evaluate('browser-start');
    const second = coordinator.evaluate('periodic');
    releaseRefresh?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(refreshCount).toBe(1);
    expect(startCount).toBe(1);
  });

  test('rechecks state after discovery so a manual start wins the race', async () => {
    const currentState = state();
    let releaseRefresh: (() => void) | undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const started: string[] = [];
    const harness = makeCoordinator(currentState, [candidate('race')], {
      refreshDrops: async () => {
        await refreshBarrier;
      },
      startFarming: async (campaign) => {
        started.push(campaign.campaignId ?? campaign.id);
      },
    });
    const evaluation = harness.coordinator.evaluate('campaign-refresh');
    harness.setState(state({ isRunning: true, selectedGame: game('manual') }));
    releaseRefresh?.();

    const result = await evaluation;

    expect(result).toEqual({
      started: false,
      skipReason: 'state-changed',
      candidate: undefined,
    });
    expect(started).toEqual([]);
  });

  test('preempts a running campaign only when a new favorite expires earlier', async () => {
    const started: string[] = [];
    const { coordinator } = makeCoordinator(
      state({ isRunning: true, selectedGame: game('current', '2030-08-03T16:00:00.000Z') }),
      [candidate('favorite-earlier', '2030-08-03T12:00:00.000Z')],
      {
        startFarming: async (campaign, context) => {
          expect(context.preempted).toBe(true);
          started.push(campaign.campaignId ?? campaign.id);
        },
      },
    );

    const result = await coordinator.evaluate('periodic');

    expect(result).toMatchObject({ started: true, preempted: true });
    expect(started).toEqual(['favorite-earlier']);
  });

  test('does not repeatedly preempt the same favorite campaign', async () => {
    let startCount = 0;
    const { coordinator } = makeCoordinator(
      state({ isRunning: true, selectedGame: game('current', '2030-08-03T16:00:00.000Z') }),
      [candidate('favorite-earlier', '2030-08-03T12:00:00.000Z')],
      {
        startFarming: async () => {
          startCount += 1;
        },
      },
    );

    await coordinator.evaluate('periodic');
    const result = await coordinator.evaluate('periodic');

    expect(startCount).toBe(1);
    expect(result).toEqual({
      started: false,
      skipReason: 'preemption-already-applied',
      candidate: undefined,
    });
  });

  test('queues but does not start while a manual watch is active', async () => {
    let startCount = 0;
    let rankedCount = 0;
    const { coordinator } = makeCoordinator(state({ manualWatchActive: true }), [candidate('manual')], {
      onRankedCampaigns: async () => {
        rankedCount += 1;
      },
      startFarming: async () => {
        startCount += 1;
      },
    });

    const result = await coordinator.evaluate('periodic');

    expect(result).toMatchObject({ started: false, skipReason: 'manual-watch-active' });
    expect(rankedCount).toBe(1);
    expect(startCount).toBe(0);
  });

  test('skips when notifications are revoked or no Twitch session is available', async () => {
    const notificationResult = await makeCoordinator(state(), [candidate('notifications')], {
      hasNotificationPermission: async () => false,
    }).coordinator.evaluate('browser-start');
    const sessionResult = await makeCoordinator(state({ twitchSessionValid: false }), [
      candidate('session'),
    ]).coordinator.evaluate('browser-start');

    expect(notificationResult).toEqual({ started: false, skipReason: 'notifications-unavailable' });
    expect(sessionResult).toEqual({ started: false, skipReason: 'twitch-session-missing' });
  });
});
