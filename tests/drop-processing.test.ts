import { describe, expect, test } from 'bun:test';
import {
  annotateGameCompletion,
  applyUnverifiableRewardMarker,
  clearSelectedCompletedIdleCampaignExt,
  clearUnverifiableRewardMarker,
  compareDropPriority,
  completedDropKeys,
  type DropsSnapshotProvenance,
  dropMatchesSelectedGame,
  dropRemainingMinutes,
  dropStateKey,
  isDropCampaignExpired,
  markDropUnverifiable,
  normalizeGameSelection,
  projectDropsSnapshot,
  recomputeSelectedCampaignSummaryAfterLocalMarker,
  reconcileUnverifiableRewardMarkers,
  resetStateForAuthoritativeEmptyCampaignExt,
  splitDropsForSelectedGame,
} from '../src/background/drops-projection.ts';
import { refreshDropsData } from '../src/background/drops-tick.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import { dropMatchesGame } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function makeState(overrides = {}) {
  const appState = {
    ...createInitialState(),
    selectedGame: null,
    allDrops: [],
    pendingDrops: [],
    completedDrops: [],
    currentDrop: null,
    availableGames: [],
  };
  return {
    appState,
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryById: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    unverifiableRewardsByKey: {},
    ...overrides,
  } as ServiceWorkerState;
}

describe('unverifiable reward markers', () => {
  const nativeDrop = {
    id: 'reward-1',
    name: 'Twitch Badge',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    progress: 99,
    currentMinutes: 59,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'twitch-badge',
    verificationState: 'unassessed',
  } satisfies TwitchDrop;
  const nativeMarkerKey = '["campaign-1","reward-1"]';

  test('preserves the exact observed baseline when marking a campaign reward', () => {
    // Given
    const state = makeState();

    // When
    const marked = markDropUnverifiable(state, nativeDrop, 123_456);

    // Then
    expect(marked).toBe(true);
    expect(state.unverifiableRewardsByKey).toEqual({
      [nativeMarkerKey]: { progress: 99, currentMinutes: 59, markedAt: 123_456 },
    });
    expect(applyUnverifiableRewardMarker(state, nativeDrop)).toMatchObject({
      progress: 99,
      currentMinutes: 59,
      verificationState: 'unverifiable',
    });
  });

  test('isolates equal reward ids by campaign when applying and clearing a marker', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 123_456);
    const sibling = { ...nativeDrop, campaignId: 'campaign-2', progress: 0, currentMinutes: 0 };

    // When
    const siblingProjection = applyUnverifiableRewardMarker(state, sibling);
    const clearedSibling = clearUnverifiableRewardMarker(state, sibling);

    // Then
    expect(siblingProjection.verificationState).toBe('unassessed');
    expect(clearedSibling).toBe(false);
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('isolates delimiter-bearing reward and campaign identities', () => {
    // Given
    const state = makeState();
    const first = { ...nativeDrop, id: 'a::b', campaignId: 'c' };
    const second = { ...nativeDrop, id: 'a', campaignId: 'b::c' };

    // When
    markDropUnverifiable(state, first, 123_456);
    const firstProjection = applyUnverifiableRewardMarker(state, first);
    const secondProjection = applyUnverifiableRewardMarker(state, second);

    // Then
    expect(firstProjection.verificationState).toBe('unverifiable');
    expect(secondProjection.verificationState).toBe('unassessed');
    expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(1);
  });

  test('never persists a marker when campaign identity is missing or blank', () => {
    // Given
    const state = makeState();
    const missingCampaign = { ...nativeDrop, campaignId: undefined };
    const blankCampaign = { ...nativeDrop, campaignId: '   ' };

    // When
    const missingMarked = markDropUnverifiable(state, missingCampaign, 1);
    const blankMarked = markDropUnverifiable(state, blankCampaign, 2);

    // Then
    expect(missingMarked).toBe(false);
    expect(blankMarked).toBe(false);
    expect(state.unverifiableRewardsByKey).toEqual({});
    expect(applyUnverifiableRewardMarker(state, missingCampaign).verificationState).toBe('unassessed');
  });

  test('preserves an exact zero-percent marker on equal inventory evidence', () => {
    // Given
    const state = makeState();
    const zeroPercentDrop = { ...nativeDrop, progress: 0, currentMinutes: 0 };
    markDropUnverifiable(state, zeroPercentDrop, 10);

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [zeroPercentDrop], updatedAt: 11 },
      'inventory-partial',
    );

    // Then
    expect(projected.progress).toBe(0);
    expect(projected.currentMinutes).toBe(0);
    expect(projected.verificationState).toBe('unverifiable');
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('preserves a marker on weaker campaign evidence', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const weaker = { ...nativeDrop, progress: 90, currentMinutes: 50 };

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      {
        games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 1 }],
        drops: [weaker],
        updatedAt: 11,
      },
      'campaign-authoritative',
    );

    // Then
    expect(projected.verificationState).toBe('unverifiable');
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('preserves a marker when only cached data is projected', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const cachedAhead = { ...nativeDrop, progress: 100, currentMinutes: 60 };

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [cachedAhead], updatedAt: 11 },
      'cached',
    );

    // Then
    expect(projected.verificationState).toBe('unverifiable');
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('clears a marker on forward percentage evidence', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const progressed = { ...nativeDrop, progress: 100 };

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [progressed], updatedAt: 11 },
      'inventory-partial',
    );

    // Then
    expect(projected.verificationState).toBe('unassessed');
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('clears a marker on forward watched-minutes evidence', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const progressed = { ...nativeDrop, currentMinutes: 60 };

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [progressed], updatedAt: 11 },
      'inventory-partial',
    );

    // Then
    expect(projected.verificationState).toBe('unassessed');
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('clears a marker only on verified acquisition rather than claimed status alone', () => {
    // Given
    const claimedWithoutProof = { ...nativeDrop, claimed: true, progress: 100 };
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [claimedWithoutProof], updatedAt: 11 },
      'cached',
    );

    // Then
    expect(projected.verificationState).toBe('unverifiable');
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('clears a marker when strict verified acquisition arrives', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const verified = { ...nativeDrop, claimed: true, progress: 100, verificationState: 'verified' as const };

    // When
    const [projected] = reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [verified], updatedAt: 11 },
      'inventory-partial',
    );

    // Then
    expect(projected.verificationState).toBe('verified');
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('clears a marker when the reward is expired', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const expired = { ...nativeDrop, endsAt: '2000-01-01T00:00:00.000Z' };

    // When
    reconcileUnverifiableRewardMarkers(state, { games: [], drops: [expired], updatedAt: 11 }, 'cached');

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('preserves disappearance on partial inventory data', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);

    // When
    reconcileUnverifiableRewardMarkers(state, { games: [], drops: [], updatedAt: 11 }, 'inventory-partial');

    // Then
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('clears a marker when an authoritative complete campaign omits the reward', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const replacement = { ...nativeDrop, id: 'reward-2', progress: 0, currentMinutes: 0 };

    // When
    reconcileUnverifiableRewardMarkers(
      state,
      {
        games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 1 }],
        drops: [replacement],
        updatedAt: 11,
      },
      'campaign-authoritative',
    );

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('preserves a missing reward when the authoritative campaign set is incomplete', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);
    const replacement = { ...nativeDrop, id: 'reward-2', progress: 0, currentMinutes: 0 };

    // When
    reconcileUnverifiableRewardMarkers(
      state,
      {
        games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 2 }],
        drops: [replacement],
        updatedAt: 11,
      },
      'campaign-authoritative',
    );

    // Then
    expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
  });

  test('clears all markers on an authoritative empty campaign snapshot', () => {
    // Given
    const state = makeState();
    markDropUnverifiable(state, nativeDrop, 10);

    // When
    reconcileUnverifiableRewardMarkers(
      state,
      { games: [], drops: [], updatedAt: 11 },
      'campaign-authoritative',
    );

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
  });
});

describe('dropRemainingMinutes', () => {
  test('returns finite value as-is with Math.max(0)', () => {
    const drop = { remainingMinutes: 45 } as TwitchDrop;
    expect(dropRemainingMinutes(drop)).toBe(45);
  });

  test('clamps negative finite values to 0', () => {
    const drop = { remainingMinutes: -10 } as TwitchDrop;
    expect(dropRemainingMinutes(drop)).toBe(0);
  });

  test('returns Infinity for missing remainingMinutes', () => {
    const drop = {} as TwitchDrop;
    expect(dropRemainingMinutes(drop)).toBe(Number.POSITIVE_INFINITY);
  });

  test('returns Infinity for NaN', () => {
    const drop = { remainingMinutes: NaN } as TwitchDrop;
    expect(dropRemainingMinutes(drop)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('compareDropPriority', () => {
  test('sorts by remainingMinutes ascending', () => {
    const a = {
      id: 'a',
      name: 'Drop A',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 50,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 100,
    } as TwitchDrop;
    const b = {
      id: 'b',
      name: 'Drop B',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 50,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 10,
    } as TwitchDrop;
    expect(compareDropPriority(a, b)).toBeGreaterThan(0);
    expect(compareDropPriority(b, a)).toBeLessThan(0);
  });

  test('breaks tie by progress descending', () => {
    const a = {
      id: 'a',
      name: 'Drop A',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 20,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 50,
    } as TwitchDrop;
    const b = {
      id: 'b',
      name: 'Drop B',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 80,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 50,
    } as TwitchDrop;
    expect(compareDropPriority(a, b)).toBeGreaterThan(0);
    expect(compareDropPriority(b, a)).toBeLessThan(0);
  });

  test('breaks tie by name ascending', () => {
    const a = {
      id: 'a',
      name: 'Zebra Drop',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 50,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 50,
    } as TwitchDrop;
    const b = {
      id: 'b',
      name: 'Alpha Drop',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      progress: 50,
      currentMinutes: 0,
      claimed: false,
      remainingMinutes: 50,
    } as TwitchDrop;
    expect(compareDropPriority(a, b)).toBeGreaterThan(0);
    expect(compareDropPriority(b, a)).toBeLessThan(0);
  });
});

describe('dropStateKey', () => {
  test('returns id::campaignId when campaignId is present', () => {
    const drop = { id: 'drop-123', campaignId: 'camp-456' } as TwitchDrop;
    expect(dropStateKey(drop)).toBe('drop-123::camp-456');
  });

  test('returns id::empty string when campaignId is missing', () => {
    const drop = { id: 'drop-789', campaignId: undefined } as TwitchDrop;
    expect(dropStateKey(drop)).toBe('drop-789::');
  });
});

describe('completedDropKeys', () => {
  test('returns empty set for empty array', () => {
    expect(completedDropKeys([])).toEqual(new Set());
  });

  test('returns set of keys for multiple drops', () => {
    const drops = [{ id: 'a', campaignId: 'c1' } as TwitchDrop, { id: 'b', campaignId: 'c2' } as TwitchDrop];
    const keys = completedDropKeys(drops);
    expect(keys.size).toBe(2);
    expect(keys.has('a::c1')).toBe(true);
    expect(keys.has('b::c2')).toBe(true);
  });
});

describe('isDropCampaignExpired', () => {
  test('returns false when endsAt is missing', () => {
    const drop = { id: '1' } as TwitchDrop;
    expect(isDropCampaignExpired(drop)).toBe(false);
  });

  test('returns false when endsAt is in the future', () => {
    const future = new Date(Date.now() + 10_000).toISOString();
    const drop = { id: '1', endsAt: future } as TwitchDrop;
    expect(isDropCampaignExpired(drop)).toBe(false);
  });

  test('returns true when endsAt is in the past', () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const drop = { id: '1', endsAt: past } as TwitchDrop;
    expect(isDropCampaignExpired(drop)).toBe(true);
  });
});

describe('dropMatchesSelectedGame', () => {
  test('delegates to dropMatchesGame', () => {
    const drop = { id: 'd1', gameId: 'g1', campaignId: 'c1', gameName: 'Game', imageUrl: '' } as TwitchDrop;
    const game = { id: 'g1', name: 'Game', imageUrl: '' };
    expect(dropMatchesSelectedGame(drop, game)).toBe(dropMatchesGame(drop, game));
  });
});

describe('normalizeGameSelection', () => {
  test('returns early when selectedGame is null', () => {
    const state = makeState({
      appState: { ...createInitialState(), selectedGame: null },
    });
    normalizeGameSelection(state, []);
    expect(state.appState.selectedGame).toBeNull();
  });

  test('updates selectedGame when a matching game is found', () => {
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
    const state = makeState({
      appState: { ...createInitialState(), selectedGame: { id: 'g1', name: 'destiny 2', imageUrl: '' } },
    });
    normalizeGameSelection(state, [game]);
    expect(state.appState.selectedGame).toBe(game);
  });

  test('sets selectedGame to null when drop vanished and no match found', () => {
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: { id: 'g999', name: 'Vanished Game', imageUrl: '', campaignId: 'c1' },
      },
    });
    normalizeGameSelection(state, [game], true);
    expect(state.appState.selectedGame).toBeNull();
  });

  test('keeps selectedGame when drop vanished=false and no match found', () => {
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
    const unmatched = { id: 'g999', name: 'Vanished Game', imageUrl: '', campaignId: 'c1' };
    const state = makeState({
      appState: { ...createInitialState(), selectedGame: unmatched },
    });
    normalizeGameSelection(state, [game], false);
    expect(state.appState.selectedGame).toBe(unmatched);
  });
});

describe('annotateGameCompletion', () => {
  test('sets allDropsCompleted=true when all matching drops are completed', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 2 };
    const drops = [
      {
        id: 'd1',
        gameId: 'g1',
        progress: 100,
        currentMinutes: 1,
        claimed: true,
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies TwitchDrop,
      {
        id: 'd2',
        gameId: 'g1',
        progress: 100,
        currentMinutes: 1,
        claimed: true,
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops, 'campaign-authoritative');
    expect(result[0].allDropsCompleted).toBe(true);
    expect(result[0].rewardSummary).toEqual({ completion: 'all-acquired', remainderReasons: [] });
  });

  test('sets allDropsCompleted=false when not all matching drops are completed', () => {
    const game = {
      id: 'g1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      dropCount: 2,
      allDropsCompleted: true,
    };
    const drops = [
      {
        id: 'd1',
        gameId: 'g1',
        progress: 100,
        currentMinutes: 1,
        claimed: true,
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies TwitchDrop,
      {
        id: 'd2',
        gameId: 'g1',
        progress: 50,
        currentMinutes: 1,
        claimed: false,
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops, 'campaign-authoritative');
    expect(result[0].allDropsCompleted).toBe(false);
    expect(result[0].rewardSummary).toEqual({ completion: 'farmable', remainderReasons: [] });
  });

  test('leaves the prior summary unchanged when expected reward count is not met', () => {
    const game = {
      id: 'g1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      dropCount: 1,
      rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
    };
    const drops = [
      {
        id: 'd1',
        gameId: 'g2',
        progress: 50,
        currentMinutes: 1,
        claimed: false,
        gameName: 'Other',
        imageUrl: '',
        campaignId: 'c2',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops, 'campaign-authoritative');
    expect(result[0]).toBe(game);
  });

  test('derives subscription-only farming completion from a complete campaign set', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 1 };
    const subscription = {
      id: 'd1',
      name: 'Sub reward',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'subscription',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;

    const [result] = annotateGameCompletion([game], [subscription], 'campaign-authoritative');

    expect(result.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required'],
    });
    expect(result.allDropsCompleted).toBe(false);
  });

  test('derives unverifiable-only farming completion from a complete campaign set', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 1 };
    const unverifiable = {
      id: 'd1',
      name: 'Badge',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      progress: 99,
      currentMinutes: 59,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unverifiable',
    } satisfies TwitchDrop;

    const [result] = annotateGameCompletion([game], [unverifiable], 'campaign-authoritative');

    expect(result.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    });
    expect(result.allDropsCompleted).toBe(false);
  });

  test('orders both farming-complete remainder reasons deterministically', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 2 };
    const subscription = {
      id: 'd1',
      name: 'Sub reward',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'subscription',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const unverifiable = {
      id: 'd2',
      name: 'Emote',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-emote',
      verificationState: 'unverifiable',
    } satisfies TwitchDrop;

    const [result] = annotateGameCompletion([game], [subscription, unverifiable], 'campaign-authoritative');

    expect(result.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    });
    expect(result.allDropsCompleted).toBe(false);
  });

  test('preserves a prior summary for partial inventory and cached projections', () => {
    const summary = { completion: 'all-acquired' as const, remainderReasons: [] };
    const game = {
      id: 'g1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      dropCount: 1,
      rewardSummary: summary,
      allDropsCompleted: true,
    };
    const partial = {
      id: 'd1',
      name: 'Reward',
      gameId: 'g1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'c1',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;

    const [inventoryResult] = annotateGameCompletion([game], [partial], 'inventory-partial');
    const [cachedResult] = annotateGameCompletion([game], [partial], 'cached');

    expect(inventoryResult).toBe(game);
    expect(cachedResult).toBe(game);
  });
});

describe('recomputeSelectedCampaignSummaryAfterLocalMarker', () => {
  test('updates only an already-known complete selected campaign with exact reward identity proof', () => {
    const selectedGame = {
      id: 'selected-game',
      name: 'Selected Game',
      imageUrl: '',
      campaignId: 'selected-campaign',
      dropCount: 1,
      rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
      allDropsCompleted: false,
    };
    const siblingGame = {
      id: 'selected-game',
      name: 'Selected Game',
      imageUrl: '',
      campaignId: 'sibling-campaign',
      dropCount: 1,
      rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
      allDropsCompleted: false,
    };
    const unverifiable = {
      id: 'badge',
      name: 'Badge',
      gameId: selectedGame.id,
      gameName: selectedGame.name,
      imageUrl: '',
      campaignId: selectedGame.campaignId,
      progress: 99,
      currentMinutes: 59,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unverifiable',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        availableGames: [selectedGame, siblingGame],
        queue: [selectedGame, siblingGame],
        allDrops: [unverifiable],
      },
    });

    expect(recomputeSelectedCampaignSummaryAfterLocalMarker(state)).toBe(true);
    expect(state.appState.selectedGame?.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    });
    expect(state.appState.availableGames[0]).toBe(state.appState.selectedGame);
    expect(state.appState.queue[0]).toBe(state.appState.selectedGame);
    expect(state.appState.availableGames[1]).toBe(siblingGame);
    expect(state.appState.queue[1]).toBe(siblingGame);
  });

  test('refuses recomputation when exact reward-count proof is missing', () => {
    const selectedGame = {
      id: 'selected-game',
      name: 'Selected Game',
      imageUrl: '',
      campaignId: 'selected-campaign',
      dropCount: 2,
      rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
      allDropsCompleted: false,
    };
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        availableGames: [selectedGame],
        queue: [selectedGame],
        allDrops: [],
      },
    });

    expect(recomputeSelectedCampaignSummaryAfterLocalMarker(state)).toBe(false);
    expect(state.appState.selectedGame).toBe(selectedGame);
    expect(state.appState.availableGames[0]).toBe(selectedGame);
    expect(state.appState.queue[0]).toBe(selectedGame);
  });
});

describe('projectDropsSnapshot', () => {
  test('handles empty snapshot', () => {
    const state = makeState();
    const snapshot = { games: [], drops: [], updatedAt: Date.now() };
    projectDropsSnapshot(state, snapshot, 'campaign-authoritative');
    expect(state.appState.availableGames).toEqual([]);
    expect(state.appState.allDrops).toEqual([]);
  });

  test('updates state with drops and games from snapshot', () => {
    const state = makeState();
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
    const drop = {
      id: 'd1',
      name: 'Drop A',
      gameId: 'g1',
      gameName: 'Destiny 2',
      imageUrl: '',
      progress: 50,
      currentMinutes: 30,
      claimed: false,
    } as TwitchDrop;
    const snapshot = { games: [game], drops: [drop], updatedAt: Date.now() };

    projectDropsSnapshot(state, snapshot, 'campaign-authoritative');

    expect(state.appState.availableGames).toHaveLength(1);
    expect(state.appState.availableGames[0].name).toBe('Destiny 2');
  });

  test('replaces availableGames when snapshot provides games', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        availableGames: [{ id: 'old', name: 'Old Game', imageUrl: '' }],
      },
    });
    const newGame = { id: 'new', name: 'New Game', imageUrl: '' };
    const snapshot = { games: [newGame], drops: [], updatedAt: Date.now() };

    projectDropsSnapshot(state, snapshot, 'campaign-authoritative');

    expect(state.appState.availableGames).toHaveLength(1);
    expect(state.appState.availableGames[0].id).toBe('new');
  });

  test('reconciles a marker before selecting the current reward', () => {
    // Given
    const game = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 1,
    } satisfies TwitchGame;
    const drop = {
      id: 'reward-1',
      name: 'Badge',
      gameId: 'game-1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      progress: 99,
      currentMinutes: 59,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: { ...createInitialState(), selectedGame: game, availableGames: [game] },
    });
    markDropUnverifiable(state, drop, 10);

    // When
    projectDropsSnapshot(state, { games: [game], drops: [drop], updatedAt: 11 }, 'campaign-authoritative');

    // Then
    expect(state.appState.currentDrop).toBeNull();
    expect(state.appState.pendingDrops[0]?.verificationState).toBe('unverifiable');
    expect(state.appState.availableGames[0]?.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    });
  });

  test('keeps a Twitch-native reward without campaign identity on the ordinary path', () => {
    // Given
    const game = { id: 'game-1', name: 'Game', imageUrl: '' } satisfies TwitchGame;
    const drop = {
      id: 'reward-1',
      name: 'Badge',
      gameId: 'game-1',
      gameName: 'Game',
      imageUrl: '',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const state = makeState({ appState: { ...createInitialState(), selectedGame: game } });

    // When
    projectDropsSnapshot(state, { games: [game], drops: [drop], updatedAt: 11 }, 'cached');

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
    expect(state.appState.currentDrop?.id).toBe('reward-1');
    expect(state.appState.currentDrop?.verificationState).toBe('unassessed');
  });

  test.each([
    'inventory-partial',
    'cached',
  ] as const)('preserves an authoritative campaign summary through a %s projection', (provenance) => {
    // Given
    const summary = {
      completion: 'farming-complete' as const,
      remainderReasons: ['unverifiable-twitch' as const],
    };
    const previousGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 1,
      rewardSummary: summary,
      allDropsCompleted: false,
    } satisfies TwitchGame;
    const rawGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 1,
    } satisfies TwitchGame;
    const state = makeState({
      appState: { ...createInitialState(), availableGames: [previousGame] },
    });

    // When
    projectDropsSnapshot(state, { games: [rawGame], drops: [], updatedAt: 11 }, provenance);

    // Then
    expect(state.appState.availableGames[0]?.rewardSummary).toEqual(summary);
    expect(state.appState.availableGames[0]?.allDropsCompleted).toBe(false);
  });

  test('preserves a trusted summary through a count-incomplete authoritative replacement', () => {
    // Given
    const rewardSummary = { completion: 'all-acquired' as const, remainderReasons: [] };
    const previousGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 2,
      rewardSummary,
      allDropsCompleted: true,
    } satisfies TwitchGame;
    const incomingGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 2,
    } satisfies TwitchGame;
    const oneKnownReward = {
      id: 'reward-1',
      name: 'Reward',
      gameId: 'game-1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      progress: 50,
      currentMinutes: 30,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: { ...createInitialState(), availableGames: [previousGame] },
    });

    // When
    projectDropsSnapshot(
      state,
      { games: [incomingGame], drops: [oneKnownReward], updatedAt: 11 },
      'campaign-authoritative',
    );

    // Then
    expect(state.appState.availableGames[0]?.rewardSummary).toEqual(rewardSummary);
    expect(state.appState.availableGames[0]?.allDropsCompleted).toBe(true);
  });

  test('rejects a blank reward id from authoritative completeness proof', () => {
    // Given
    const game = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 0,
    } satisfies TwitchGame;
    const malformedAcquiredReward = {
      id: '   ',
      name: 'Malformed Reward',
      gameId: 'game-1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      progress: 100,
      currentMinutes: 60,
      claimed: true,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const state = makeState();

    // When
    projectDropsSnapshot(
      state,
      { games: [game], drops: [malformedAcquiredReward], updatedAt: 11 },
      'campaign-authoritative',
    );

    // Then
    expect(state.appState.availableGames[0]?.rewardSummary).toBeUndefined();
    expect(state.appState.availableGames[0]?.allDropsCompleted).toBeUndefined();
  });
});

describe('refreshDropsData projection provenance', () => {
  const cachedDrop = {
    id: 'reward-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  } satisfies TwitchDrop;
  const game = {
    id: 'game-1',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    dropCount: 1,
  } satisfies TwitchGame;

  function projectionDeps(observed: DropsSnapshotProvenance[]) {
    return {
      replaceAvailableGames: (games: TwitchGame[]) => games,
      getGameDisplayLabel: (candidate: TwitchGame) => candidate.name,
      projectDropsSnapshot: (
        _state: ServiceWorkerState,
        _snapshot: { games: TwitchGame[]; drops: TwitchDrop[]; updatedAt: number },
        provenance: DropsSnapshotProvenance,
      ) => observed.push(provenance),
      normalizeQueueSelection: () => undefined,
    };
  }

  test('passes campaign-authoritative provenance for a successful campaign refresh', async () => {
    // Given
    const observed: DropsSnapshotProvenance[] = [];
    const state = makeState();

    // When
    await refreshDropsData(
      state,
      { includeCampaignFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => ({ games: [game], drops: [cachedDrop], updatedAt: 1 }),
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      projectionDeps(observed),
    );

    // Then
    expect(observed).toEqual(['campaign-authoritative']);
  });

  test('passes inventory-partial provenance for a successful inventory refresh', async () => {
    // Given
    const observed: DropsSnapshotProvenance[] = [];
    const state = makeState({ cachedDropsSnapshot: [cachedDrop] });

    // When
    await refreshDropsData(
      state,
      { includeInventoryFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => null,
        onFetchInventorySnapshotFromApi: async () => ({
          games: [],
          drops: [{ ...cachedDrop, progress: 1 }],
          updatedAt: 1,
        }),
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      projectionDeps(observed),
    );

    // Then
    expect(observed).toEqual(['inventory-partial']);
  });

  test('passes cached provenance after a failed campaign refresh', async () => {
    // Given
    const observed: DropsSnapshotProvenance[] = [];
    const state = makeState({ cachedDropsSnapshot: [cachedDrop] });

    // When
    await refreshDropsData(
      state,
      { includeCampaignFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => null,
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      projectionDeps(observed),
    );

    // Then
    expect(observed).toEqual(['cached']);
  });

  test('clears stale projection after a successful explicit zero-reward campaign refresh', async () => {
    // Given
    const staleDrop = {
      ...cachedDrop,
      name: 'Badge',
      progress: 99,
      currentMinutes: 59,
      rewardKind: 'twitch-badge',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
        availableGames: [game],
        allDrops: [staleDrop],
        pendingDrops: [staleDrop],
      },
      cachedDropsSnapshot: [staleDrop],
    });
    markDropUnverifiable(state, staleDrop, 10);

    // When
    await refreshDropsData(
      state,
      { includeCampaignFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => ({
          games: [{ ...game, dropCount: 0 }],
          drops: [],
          updatedAt: 2,
        }),
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      {
        replaceAvailableGames: (games) => games,
        getGameDisplayLabel: (candidate) => candidate.name,
        projectDropsSnapshot,
        normalizeQueueSelection: () => undefined,
      },
    );

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
    expect(state.cachedDropsSnapshot).toEqual([]);
    expect(state.appState.allDrops).toEqual([]);
    expect(state.appState.currentDrop).toBeNull();
  });

  test('clears markers and stale projected games when campaign refresh returns no games or drops', async () => {
    // Given
    const staleDrop = {
      ...cachedDrop,
      name: 'Badge',
      progress: 99,
      currentMinutes: 59,
      rewardKind: 'twitch-badge',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
        availableGames: [game],
        allDrops: [staleDrop],
        pendingDrops: [staleDrop],
        currentDrop: staleDrop,
      },
      cachedDropsSnapshot: [staleDrop],
    });
    markDropUnverifiable(state, staleDrop, 10);

    // When
    await refreshDropsData(
      state,
      { includeCampaignFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => ({ games: [], drops: [], updatedAt: 2 }),
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      {
        replaceAvailableGames: (games) => games,
        getGameDisplayLabel: (candidate) => candidate.name,
        projectDropsSnapshot,
        normalizeQueueSelection: () => undefined,
      },
    );

    // Then
    expect(state.unverifiableRewardsByKey).toEqual({});
    expect(state.appState.availableGames).toEqual([]);
    expect(state.appState.allDrops).toEqual([]);
    expect(state.appState.pendingDrops).toEqual([]);
    expect(state.appState.currentDrop).toBeNull();
  });

  test('preserves markers and projected state when inventory refresh returns an empty partial snapshot', async () => {
    // Given
    const staleDrop = {
      ...cachedDrop,
      name: 'Badge',
      progress: 99,
      currentMinutes: 59,
      rewardKind: 'twitch-badge',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
        availableGames: [game],
        allDrops: [staleDrop],
        pendingDrops: [staleDrop],
        currentDrop: staleDrop,
      },
      cachedDropsSnapshot: [staleDrop],
    });
    markDropUnverifiable(state, staleDrop, 10);

    // When
    await refreshDropsData(
      state,
      { includeInventoryFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => null,
        onFetchInventorySnapshotFromApi: async () => ({ games: [], drops: [], updatedAt: 2 }),
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      {
        replaceAvailableGames: (games) => games,
        getGameDisplayLabel: (candidate) => candidate.name,
        projectDropsSnapshot,
        normalizeQueueSelection: () => undefined,
      },
    );

    // Then
    expect(state.unverifiableRewardsByKey['["campaign-1","reward-1"]']).toBeDefined();
    expect(state.appState.availableGames.map((candidate) => candidate.id)).toEqual(['game-1']);
    expect(state.appState.allDrops.map((drop) => drop.id)).toEqual(['reward-1']);
  });

  test('preserves markers and projected state when campaign refresh fails and cached state is used', async () => {
    // Given
    const staleDrop = {
      ...cachedDrop,
      name: 'Badge',
      progress: 99,
      currentMinutes: 59,
      rewardKind: 'twitch-badge',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
        availableGames: [game],
        allDrops: [staleDrop],
        pendingDrops: [staleDrop],
        currentDrop: staleDrop,
      },
      cachedDropsSnapshot: [staleDrop],
    });
    markDropUnverifiable(state, staleDrop, 10);

    // When
    await refreshDropsData(
      state,
      { includeCampaignFetch: true, suppressNotifications: true },
      {
        onFetchDropsSnapshotFromApi: async () => null,
        onEvaluateDropTransitions: async () => undefined,
        onSaveState: async () => undefined,
      },
      {
        replaceAvailableGames: (games) => games,
        getGameDisplayLabel: (candidate) => candidate.name,
        projectDropsSnapshot,
        normalizeQueueSelection: () => undefined,
      },
    );

    // Then
    expect(state.unverifiableRewardsByKey['["campaign-1","reward-1"]']).toBeDefined();
    expect(state.appState.availableGames.map((candidate) => candidate.id)).toEqual(['game-1']);
    expect(state.appState.allDrops.map((drop) => drop.id)).toEqual(['reward-1']);
  });
});

describe('splitDropsForSelectedGame', () => {
  test('null selectedGame clears all drop state', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        allDrops: [
          {
            id: 'old',
            name: 'Old',
            gameId: 'g1',
            gameName: 'G',
            imageUrl: '',
            progress: 50,
            currentMinutes: 0,
            claimed: false,
          } as TwitchDrop,
        ],
        pendingDrops: [],
        completedDrops: [],
        currentDrop: null,
      },
      lastTrackedDropKey: 'old-key',
      lastTrackedProgress: 50,
      lastTrackedMinutes: 30,
    });

    splitDropsForSelectedGame(state, []);

    expect(state.appState.allDrops).toEqual([]);
    expect(state.appState.pendingDrops).toEqual([]);
    expect(state.appState.completedDrops).toEqual([]);
    expect(state.appState.currentDrop).toBeNull();
    expect(state.lastTrackedDropKey).toBeNull();
    expect(state.lastTrackedMinutes).toBe(-1);
  });

  test('matching drops are placed into correct categories', () => {
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '', campaignId: 'c1' };
    const drop = {
      id: 'd1',
      name: 'Drop A',
      gameId: 'g1',
      gameName: 'Destiny 2',
      imageUrl: '',
      progress: 50,
      currentMinutes: 30,
      claimed: false,
      campaignId: 'c1',
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } as TwitchDrop;

    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
      },
    });

    splitDropsForSelectedGame(state, [drop]);

    expect(state.appState.allDrops).toHaveLength(1);
    expect(state.appState.pendingDrops.length).toBeGreaterThanOrEqual(0);
    expect(state.appState.completedDrops).toHaveLength(0);
  });

  test('claimed farmable drop does not become currentDrop', () => {
    const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
    const claimedDrop = {
      id: 'd1',
      name: 'Claimed Reward',
      gameId: 'g1',
      gameName: 'IL',
      imageUrl: '',
      progress: 100,
      currentMinutes: 60,
      claimed: true,
      claimable: false,
      campaignId: 'c1',
      requiredMinutes: 60,
      remainingMinutes: 0,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } as TwitchDrop;

    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
      },
    });

    splitDropsForSelectedGame(state, [claimedDrop]);

    expect(state.appState.completedDrops).toHaveLength(1);
    expect(state.appState.pendingDrops).toHaveLength(0);
    expect(state.appState.currentDrop).toBeNull();
  });

  test('claimed Twitch-native observation without verification does not become currentDrop', () => {
    const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
    const claimedBadge = {
      id: 'badge-1',
      name: 'Claimed Badge',
      gameId: 'g1',
      gameName: 'IL',
      imageUrl: '',
      progress: 100,
      currentMinutes: 60,
      claimed: true,
      campaignId: 'c1',
      requiredMinutes: 60,
      remainingMinutes: 0,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    } satisfies TwitchDrop;
    const watchReward = {
      ...claimedBadge,
      id: 'watch-1',
      name: 'Next Reward',
      progress: 20,
      currentMinutes: 12,
      claimed: false,
      remainingMinutes: 48,
      rewardKind: 'in-game',
    } satisfies TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
      },
    });

    splitDropsForSelectedGame(state, [claimedBadge, watchReward]);

    expect(state.appState.pendingDrops).toHaveLength(2);
    expect(state.appState.currentDrop?.id).toBe('watch-1');
  });

  test('fully watched unclaimable drop does not become currentDrop', () => {
    const game = { id: 'g1', name: 'Subnautica', imageUrl: '', campaignId: 'c1' };
    const earnedDrop = {
      id: 'd1',
      name: 'Locked Account Reward',
      gameId: 'g1',
      gameName: 'Subnautica',
      imageUrl: '',
      progress: 100,
      currentMinutes: 60,
      claimed: false,
      claimable: false,
      campaignId: 'c1',
      requiredMinutes: 60,
      remainingMinutes: 0,
      status: 'completed',
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } as TwitchDrop;

    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
      },
    });

    splitDropsForSelectedGame(state, [earnedDrop]);

    expect(state.appState.completedDrops).toHaveLength(1);
    expect(state.appState.pendingDrops).toHaveLength(0);
    expect(state.appState.currentDrop).toBeNull();
  });

  test('campaign with all farmable drops claimed has no pending drops or currentDrop', () => {
    const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
    const drops = [
      {
        id: 'd1',
        name: 'Claimed Reward A',
        gameId: 'g1',
        gameName: 'IL',
        imageUrl: '',
        progress: 100,
        currentMinutes: 60,
        claimed: true,
        claimable: false,
        campaignId: 'c1',
        requiredMinutes: 60,
        remainingMinutes: 0,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
      {
        id: 'd2',
        name: 'Claimed Reward B',
        gameId: 'g1',
        gameName: 'IL',
        imageUrl: '',
        progress: 100,
        currentMinutes: 120,
        claimed: true,
        claimable: false,
        campaignId: 'c1',
        requiredMinutes: 120,
        remainingMinutes: 0,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ] as TwitchDrop[];

    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
      },
    });

    splitDropsForSelectedGame(state, drops);

    expect(state.appState.completedDrops).toHaveLength(2);
    expect(state.appState.pendingDrops).toHaveLength(0);
    expect(state.appState.currentDrop).toBeNull();
  });

  test('no strict matches triggers relaxed fallback (drops with name overlap)', () => {
    const selected = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
    const fallback = {
      id: 'd1',
      name: 'Drop',
      gameId: 'g1',
      gameName: 'Destiny 2',
      imageUrl: '',
      progress: 20,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } as TwitchDrop;

    const state = makeState({
      appState: { ...createInitialState(), selectedGame: selected },
    });

    splitDropsForSelectedGame(state, [fallback]);

    expect(state.appState.allDrops.length).toBeGreaterThan(0);
  });

  test('clears recovery state when tracked drop progress advances', () => {
    const game = { id: 'g1', name: 'Destiny 2', imageUrl: '', campaignId: 'c1' };
    const previousDrop = {
      id: 'd1',
      name: 'Drop A',
      gameId: 'g1',
      gameName: 'Destiny 2',
      imageUrl: '',
      progress: 20,
      currentMinutes: 20,
      claimed: false,
      campaignId: 'c1',
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } as TwitchDrop;
    const nextDrop = {
      ...previousDrop,
      progress: 25,
      currentMinutes: 25,
    };
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame: game,
        recoveryReason: 'stalled-progress',
        recoveryBackoffUntil: Date.now() + 60_000,
        recoveryAttempts: 2,
        allDrops: [previousDrop],
      },
      lastTrackedDropKey: 'd1::c1',
      lastTrackedProgress: 20,
      lastTrackedMinutes: 20,
      lastProgressAdvanceAt: Date.now() - 10 * 60_000,
      noProgressRotationAttempts: 3,
      recoveryBackoffUntil: Date.now() + 60_000,
      lastRecoveryAttemptAt: Date.now() - 60_000,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: true,
    });

    splitDropsForSelectedGame(state, [nextDrop]);

    expect(state.lastTrackedProgress).toBe(25);
    expect(state.noProgressRotationAttempts).toBe(0);
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.recoveryBackoffUntil).toBe(0);
    expect(state.recoveryNotificationSent).toBe(false);
    expect(state.appState.recoveryReason).toBeNull();
  });
});

describe('clearSelectedCompletedIdleCampaignExt', () => {
  const selectedGame: TwitchGame = {
    id: 'game-1',
    name: 'Test Game',
    campaignId: 'campaign-1',
    categorySlug: 'test-game',
  } as TwitchGame;

  const completedDrop = {
    id: 'drop-1',
    name: 'Completed Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    claimed: true,
    progress: 100,
    currentMinutes: 100,
    requiredMinutes: 100,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  } satisfies TwitchDrop;

  const farmablePendingDrop = {
    id: 'drop-2',
    name: 'Pending Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    claimed: false,
    progress: 50,
    currentMinutes: 50,
    requiredMinutes: 100,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  } satisfies TwitchDrop;

  const subscriptionDrop = {
    id: 'drop-3',
    name: 'Subscriber Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    claimed: false,
    progress: 50,
    currentMinutes: 50,
    requiredMinutes: 100,
    acquisitionMethod: 'subscription',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  } satisfies TwitchDrop;

  test('no-op when isRunning=true', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        isRunning: true,
        selectedGame,
        queue: [],
        allDrops: [completedDrop],
      },
      cachedDropsSnapshot: [completedDrop],
    });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBe(selectedGame);
  });

  test('no-op when selectedGame is null', () => {
    const state = makeState({ cachedDropsSnapshot: [completedDrop] });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.allDrops).toEqual([]);
  });

  test('no-op when queue has items', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        queue: [{ gameId: 'game-1' } as TwitchGame],
        allDrops: [completedDrop],
      },
      cachedDropsSnapshot: [completedDrop],
    });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBe(selectedGame);
    expect(state.appState.allDrops).toEqual([completedDrop]);
  });

  test('no-op when there is a farmable pending drop', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        queue: [],
        allDrops: [farmablePendingDrop],
        pendingDrops: [farmablePendingDrop],
      },
      cachedDropsSnapshot: [farmablePendingDrop],
    });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBe(selectedGame);
    expect(state.appState.allDrops).toEqual([farmablePendingDrop]);
  });

  test('wipes when only a subscription-gated reward remains', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        queue: [],
        allDrops: [subscriptionDrop],
        pendingDrops: [subscriptionDrop],
      },
      cachedDropsSnapshot: [subscriptionDrop],
    });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.allDrops).toEqual([]);
  });

  test('wipes selection and projections when only completed drops remain', () => {
    const state = makeState({
      appState: {
        ...createInitialState(),
        selectedGame,
        queue: [],
        allDrops: [completedDrop],
        pendingDrops: [completedDrop],
        completedDrops: [completedDrop],
        currentDrop: completedDrop,
        completionNotified: true,
      },
      cachedDropsSnapshot: [completedDrop],
      previousAllDropsCount: 5,
    });
    clearSelectedCompletedIdleCampaignExt(state);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.currentDrop).toBeNull();
    expect(state.appState.allDrops).toEqual([]);
    expect(state.appState.pendingDrops).toEqual([]);
    expect(state.appState.completedDrops).toEqual([]);
    expect(state.appState.completionNotified).toBe(false);
    expect(state.previousAllDropsCount).toBe(0);
  });
});

describe('resetStateForAuthoritativeEmptyCampaignExt', () => {
  test('wipes volatile campaign state including unverifiable markers', () => {
    const game: TwitchGame = { id: 'g1', name: 'G1' } as TwitchGame;
    const drop = { id: 'd1' } as TwitchDrop;
    const state = makeState({
      appState: {
        ...createInitialState(),
        availableGames: [game],
        queue: [game],
        selectedGame: game,
        currentDrop: drop,
        allDrops: [drop],
        pendingDrops: [drop],
        completedDrops: [drop],
        completionNotified: true,
        lastSuccessfulRefreshAt: 12345,
      },
      cachedDropsSnapshot: [drop],
      cachedCampaignChannelsMap: { 'campaign-1': ['streamer-a'] },
      previousAllDropsCount: 9,
      unverifiableRewardsByKey: {
        '["c1","d1"]': { progress: 99, currentMinutes: 59, markedAt: 10 },
      },
    });
    resetStateForAuthoritativeEmptyCampaignExt(state);
    expect(state.appState.availableGames).toEqual([]);
    expect(state.appState.queue).toEqual([]);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.currentDrop).toBeNull();
    expect(state.appState.allDrops).toEqual([]);
    expect(state.appState.pendingDrops).toEqual([]);
    expect(state.appState.completedDrops).toEqual([]);
    expect(state.appState.completionNotified).toBe(false);
    expect(state.cachedDropsSnapshot).toEqual([]);
    expect(state.cachedCampaignChannelsMap).toEqual({});
    expect(state.previousAllDropsCount).toBe(0);
    expect(state.unverifiableRewardsByKey).toEqual({});
  });
});
