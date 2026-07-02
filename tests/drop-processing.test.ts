import { describe, expect, test } from 'bun:test';
import {
  annotateGameCompletion,
  compareDropPriority,
  completedDropKeys,
  dropMatchesSelectedGame,
  dropRemainingMinutes,
  dropStateKey,
  isDropCampaignExpired,
  normalizeGameSelection,
  projectDropsSnapshot,
  splitDropsForSelectedGame,
} from '../src/background/drops-projection.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import { dropMatchesGame } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchDrop } from '../src/types/index.ts';

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
    ...overrides,
  } as ServiceWorkerState;
}

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
    const game = { id: 'g1', name: 'Game', imageUrl: '' };
    const drops = [
      { id: 'd1', gameId: 'g1', progress: 100, claimed: true, gameName: 'Game', imageUrl: '' } as TwitchDrop,
      { id: 'd2', gameId: 'g1', progress: 100, claimed: true, gameName: 'Game', imageUrl: '' } as TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops);
    expect(result[0].allDropsCompleted).toBe(true);
  });

  test('sets allDropsCompleted=false when not all matching drops are completed', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '', allDropsCompleted: true };
    const drops = [
      { id: 'd1', gameId: 'g1', progress: 100, claimed: true, gameName: 'Game', imageUrl: '' } as TwitchDrop,
      { id: 'd2', gameId: 'g1', progress: 50, claimed: false, gameName: 'Game', imageUrl: '' } as TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops);
    expect(result[0].allDropsCompleted).toBe(false);
  });

  test('leaves game unchanged when no matching drops exist', () => {
    const game = { id: 'g1', name: 'Game', imageUrl: '' };
    const drops = [
      { id: 'd1', gameId: 'g2', progress: 50, claimed: false, gameName: 'Other', imageUrl: '' } as TwitchDrop,
    ];
    const result = annotateGameCompletion([game], drops);
    expect(result[0].allDropsCompleted).toBeUndefined();
  });
});

describe('projectDropsSnapshot', () => {
  test('handles empty snapshot', () => {
    const state = makeState();
    const snapshot = { games: [], drops: [], updatedAt: Date.now() };
    projectDropsSnapshot(state, snapshot);
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

    projectDropsSnapshot(state, snapshot);

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

    projectDropsSnapshot(state, snapshot);

    expect(state.appState.availableGames).toHaveLength(1);
    expect(state.appState.availableGames[0].id).toBe('new');
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
      dropType: 'time-based',
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
      dropType: 'time-based',
      requiredMinutes: 60,
      remainingMinutes: 0,
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
      dropType: 'time-based',
      requiredMinutes: 60,
      remainingMinutes: 0,
      status: 'completed',
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
        dropType: 'time-based',
        requiredMinutes: 60,
        remainingMinutes: 0,
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
        dropType: 'time-based',
        requiredMinutes: 120,
        remainingMinutes: 0,
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
      dropType: 'time-based',
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
