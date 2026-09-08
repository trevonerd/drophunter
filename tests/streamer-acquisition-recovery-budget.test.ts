import { afterEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { NO_STREAMERS_RETRY_MS } from '../src/background/stream-rotation.ts';
import { TwitchDirectoryUnavailableError } from '../src/background/twitch-api/errors.ts';
import type { TwitchGame } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

type RecoveryFixture = ReturnType<typeof createRecoveryFixture>;

function createRecoveryFixture() {
  const first = createGame({
    id: 'first-game',
    campaignId: 'first-campaign',
    categorySlug: 'first-game',
  });
  const second = createGame({
    id: 'second-game',
    name: 'Second Game',
    campaignId: 'second-campaign',
    categorySlug: 'second-game',
  });
  const drops = [
    createDrop({ id: 'first-drop', gameId: first.id, campaignId: first.campaignId }),
    createDrop({ id: 'second-drop', gameId: second.id, campaignId: second.campaignId }),
  ];
  const state = createMinimalState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.selectedGame = first;
  state.appState.availableGames = [first, second];
  state.appState.queue = [first, second];
  state.appState.allDrops = drops;
  state.appState.pendingDrops = drops;
  state.appState.currentDrop = drops[0] ?? null;
  state.cachedDropsSnapshot = drops;
  state.lastInventoryRefreshAt = Date.now();
  return { first, second, state };
}

function directoryResultForNextCampaign(game: TwitchGame, fixture: RecoveryFixture) {
  return game.campaignId === fixture.second.campaignId
    ? Object.assign([createStreamer({ name: 'second-streamer' })], { languageFilterApplied: true })
    : Object.assign([], { languageFilterApplied: true });
}

describe('streamer acquisition recovery budget', () => {
  let chrome: ChromeMocks;
  const realDateNow = Date.now;

  afterEach(() => {
    Date.now = realDateNow;
    chrome?.teardown();
  });

  test('advances after Twitch API backoff interrupts the no-streamers retry', async () => {
    chrome = setupChromeMocks();
    let now = 4_000_000;
    Date.now = () => now;
    const fixture = createRecoveryFixture();
    const openedChannels: string[] = [];
    const session = createFarmingSession(
      fixture.state,
      createFarmingSessionAdapters({
        fetchDirectoryStreamersFromApi: async (game) => directoryResultForNextCampaign(game, fixture),
        openForegroundChannel: async (streamer) => {
          openedChannels.push(streamer.name);
        },
        watchTransport: {
          start: async (streamer) => {
            openedChannels.push(streamer.name);
            return {
              mode: 'managed-tab',
              status: 'started',
              reason: null,
              isHealthy: true,
              shouldFallback: false,
              checkedAt: now,
            };
          },
          tick: async () => ({
            mode: 'managed-tab',
            status: 'not-started',
            reason: 'not-started',
            isHealthy: false,
            shouldFallback: false,
            checkedAt: now,
          }),
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await session.acquireStreamerForSelectedGame();
    fixture.state.apiConsecutiveFailures = 1;
    fixture.state.apiBackoffUntil = now + NO_STREAMERS_RETRY_MS;
    await session.checkDropProgress();
    now += NO_STREAMERS_RETRY_MS;
    fixture.state.apiBackoffUntil = 0;
    await session.acquireStreamerForSelectedGame();

    expect(fixture.state.appState.selectedGame?.campaignId).toBe(fixture.second.campaignId);
    expect(fixture.state.appState.queue.map((game) => game.campaignId)).toEqual([fixture.second.campaignId]);
    expect(openedChannels).toEqual(['second-streamer']);
  });

  test('advances after the directory remains unavailable for the retry budget', async () => {
    chrome = setupChromeMocks();
    let now = 5_000_000;
    Date.now = () => now;
    const fixture = createRecoveryFixture();
    let firstCampaignAttempts = 0;
    const openedChannels: string[] = [];
    const session = createFarmingSession(
      fixture.state,
      createFarmingSessionAdapters({
        fetchDirectoryStreamersFromApi: async (game) => {
          if (game.campaignId === fixture.first.campaignId) {
            firstCampaignAttempts += 1;
            throw new TwitchDirectoryUnavailableError(new Error('directory unavailable'));
          }
          return directoryResultForNextCampaign(game, fixture);
        },
        openForegroundChannel: async (streamer) => {
          openedChannels.push(streamer.name);
        },
      }),
    );

    await session.acquireStreamerForSelectedGame();
    now += NO_STREAMERS_RETRY_MS;
    await session.acquireStreamerForSelectedGame();

    expect(firstCampaignAttempts).toBe(2);
    expect(fixture.state.appState.selectedGame?.campaignId).toBe(fixture.second.campaignId);
    expect(fixture.state.appState.queue.map((game) => game.campaignId)).toEqual([fixture.second.campaignId]);
    expect(openedChannels).toEqual(['second-streamer']);
  });
});
