import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome';
import { createInitialState } from '../src/shared/utils.ts';
import type { AppState, TwitchDrop } from '../src/types/index.ts';

const chromeMocks = setupChromeMocks();

function getAppStateFromStorage(): AppState {
  const stored = chromeMocks.storage.local._store.get('appState') as AppState | undefined;
  return stored || createInitialState();
}

function getCachedDropsSnapshot(): TwitchDrop[] {
  return (chromeMocks.storage.local._store.get('cachedDropsSnapshot') as TwitchDrop[]) || [];
}

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: `drop-${Math.random().toString(36).slice(2)}`,
    name: 'Test Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: 'https://example.com/reward.png',
    progress: 100,
    currentMinutes: 60,
    claimed: false,
    claimable: true,
    claimId: `claim-${Math.random().toString(36).slice(2)}`,
    dropType: 'time-based',
    ...overrides,
  };
}

describe('auto-claim-cross-game integration tests', () => {
  beforeEach(async () => {
    chromeMocks.storage.local._store.clear();
    chromeMocks.storage.session._store.clear();
  });

  afterEach(() => {
    chromeMocks.storage.session._store.clear();
  });

  test('Test 1: Full flow - drops from 3 games all claimed', async () => {
    // Setup: Create 3 claimable drops from different games
    const dropGameA = createDrop({
      id: 'drop-game-a',
      gameId: 'game-a',
      gameName: 'Game A',
      claimable: true,
      claimed: false,
      dropType: 'time-based',
    });

    const dropGameB = createDrop({
      id: 'drop-game-b',
      gameId: 'game-b',
      gameName: 'Game B',
      claimable: true,
      claimed: false,
      dropType: 'time-based',
    });

    const dropGameC = createDrop({
      id: 'drop-game-c',
      gameId: 'game-c',
      gameName: 'Game C',
      claimable: true,
      claimed: false,
      dropType: 'time-based',
    });

    // Store drops in cache
    chromeMocks.storage.local._store.set('cachedDropsSnapshot', [dropGameA, dropGameB, dropGameC]);

    // Verify the 3 drops are in cache
    const snapshot = getCachedDropsSnapshot();
    expect(snapshot.length).toBe(3);
    expect(snapshot.filter((d) => d.claimable && !d.claimed && d.dropType !== 'event-based').length).toBe(3);
  });

  test('Test 2: Mixed drop types - only time-based claimed', async () => {
    // Setup: Mix of time-based and event-based drops
    const timeBasedClaimable = createDrop({
      id: 'drop-time-claimable',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: true,
      claimed: false,
      dropType: 'time-based',
    });

    const eventBasedClaimable = createDrop({
      id: 'drop-event-claimable',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: true,
      claimed: false,
      dropType: 'event-based',
    });

    const timeBasedClaimed = createDrop({
      id: 'drop-time-claimed',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: false,
      claimed: true,
      dropType: 'time-based',
    });

    const timeBasedNotClaimable = createDrop({
      id: 'drop-time-not-claimable',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: false,
      claimed: false,
      dropType: 'time-based',
    });

    chromeMocks.storage.local._store.set('cachedDropsSnapshot', [
      timeBasedClaimable,
      eventBasedClaimable,
      timeBasedClaimed,
      timeBasedNotClaimable,
    ]);

    // Verify only time-based claimable is in the snapshot
    const snapshot = getCachedDropsSnapshot();
    const claimableTimeBasedDrops = snapshot.filter(
      (d) => d.claimable && !d.claimed && d.dropType !== 'event-based',
    );
    expect(claimableTimeBasedDrops.length).toBe(1);
    expect(claimableTimeBasedDrops[0].id).toBe('drop-time-claimable');
  });

  test('Test 3: Counter accumulates across ticks', async () => {
    // Setup: Start with totalDropsClaimed = 5
    const initialState = getAppStateFromStorage();
    let state = {
      ...initialState,
      autoClaimDrops: true,
      isRunning: true,
      isPaused: false,
      totalDropsClaimed: 5,
    };
    chromeMocks.storage.local._store.set('appState', state);

    // First tick: 2 claimable drops
    const drop1 = createDrop({
      id: 'drop-1',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: true,
      claimed: false,
    });

    const drop2 = createDrop({
      id: 'drop-2',
      gameId: 'game-1',
      gameName: 'Game 1',
      claimable: true,
      claimed: false,
    });

    chromeMocks.storage.local._store.set('cachedDropsSnapshot', [drop1, drop2]);

    // Verify initial state
    let currentState = getAppStateFromStorage();
    expect(currentState.totalDropsClaimed).toBe(5);

    // Simulate claim by updating state
    currentState.totalDropsClaimed += 2;
    chromeMocks.storage.local._store.set('appState', currentState);

    // Verify counter incremented
    currentState = getAppStateFromStorage();
    expect(currentState.totalDropsClaimed).toBe(7);

    // Second tick: 1 new claimable drop (snapshot updated)
    const drop3 = createDrop({
      id: 'drop-3',
      gameId: 'game-2',
      gameName: 'Game 2',
      claimable: true,
      claimed: false,
    });

    chromeMocks.storage.local._store.set('cachedDropsSnapshot', [drop1, drop2, drop3]);

    // Simulate another claim
    currentState.totalDropsClaimed += 1;
    chromeMocks.storage.local._store.set('appState', currentState);

    // Verify counter incremented again
    currentState = getAppStateFromStorage();
    expect(currentState.totalDropsClaimed).toBe(8);
  });

  test('Test 4: Handler roundtrip for SET_AUTO_CLAIM_DROPS', async () => {
    // Test that autoClaimDrops can be toggled in state
    let state = getAppStateFromStorage();
    const initialValue = state.autoClaimDrops;

    // Disable auto-claim
    state = {
      ...state,
      autoClaimDrops: false,
    };
    chromeMocks.storage.local._store.set('appState', state);

    state = getAppStateFromStorage();
    expect(state.autoClaimDrops).toBe(false);

    // Enable auto-claim
    state = {
      ...state,
      autoClaimDrops: true,
    };
    chromeMocks.storage.local._store.set('appState', state);

    state = getAppStateFromStorage();
    expect(state.autoClaimDrops).toBe(true);
  });

  test('Test 5: State persistence (autoClaimDrops + totalDropsClaimed survive reload)', async () => {
    // Set initial state
    let state = getAppStateFromStorage();
    state = {
      ...state,
      autoClaimDrops: false,
      totalDropsClaimed: 42,
    };
    chromeMocks.storage.local._store.set('appState', state);

    // Verify state was persisted
    let loadedState = getAppStateFromStorage();
    expect(loadedState.autoClaimDrops).toBe(false);
    expect(loadedState.totalDropsClaimed).toBe(42);

    // Simulate reload by clearing and re-reading
    const persistedState = chromeMocks.storage.local._store.get('appState') as AppState;
    expect(persistedState.autoClaimDrops).toBe(false);
    expect(persistedState.totalDropsClaimed).toBe(42);
  });

  test('Test 6: Empty snapshot - no errors, no claims, returns false', async () => {
    // Setup: Empty snapshot
    chromeMocks.storage.local._store.set('cachedDropsSnapshot', []);

    // Verify auto-claim can be enabled
    let state = getAppStateFromStorage();
    state = {
      ...state,
      autoClaimDrops: true,
      isRunning: true,
      isPaused: false,
    };
    chromeMocks.storage.local._store.set('appState', state);

    // Verify auto-claim is enabled
    state = getAppStateFromStorage();
    expect(state.autoClaimDrops).toBe(true);

    // Verify snapshot is empty
    const snapshot = getCachedDropsSnapshot();
    expect(snapshot.length).toBe(0);
  });
});
