import { expect, test } from '@playwright/test';
import {
  createExtensionProfile,
  getExtensionWorker,
  openPopup,
  seedAppState,
} from './extension-fixture';

type FixtureGame = {
  id: string;
  campaignId: string;
  name: string;
  categorySlug: string;
  imageUrl: string;
  dropCount: number;
};

const games: FixtureGame[] = [
  {
    id: 'e2e-game-one',
    campaignId: 'e2e-campaign-one',
    name: 'Local Game One',
    categorySlug: 'local-game-one',
    imageUrl: '',
    dropCount: 1,
  },
  {
    id: 'e2e-game-two',
    campaignId: 'e2e-campaign-two',
    name: 'Local Game Two',
    categorySlug: 'local-game-two',
    imageUrl: '',
    dropCount: 1,
  },
];

const streamers = new Map([
  ['local-game-one', 'local-stream-one'],
  ['local-game-two', 'local-stream-two'],
]);

type ProgressPhase = 'starting' | 'progressed' | 'complete';
type GqlQuery = {
  readonly operationName?: string;
  readonly variables?: Record<string, unknown>;
};

function campaignRecord(game: FixtureGame) {
  const drop = {
    id: `drop-${game.campaignId}`,
    name: `${game.name} Reward`,
    requiredMinutesWatched: 2,
    endAt: new Date(Date.now() + 86_400_000).toISOString(),
    benefitEdges: [],
  };
  return {
    id: game.campaignId,
    status: 'ACTIVE',
    endAt: new Date(Date.now() + 86_400_000).toISOString(),
    game: {
      displayName: game.name,
      name: game.name,
      slug: game.categorySlug,
      boxArtURL: game.imageUrl,
    },
    timeBasedDrops: [drop],
    eventBasedDrops: [],
  };
}

function progressFor(game: FixtureGame, phase: ProgressPhase): number {
  if (game.campaignId === games[0]?.campaignId) {
    return phase === 'progressed' ? 1 : phase === 'complete' ? 2 : 0;
  }
  return 0;
}

async function installLocalTwitchFixture(profile: Awaited<ReturnType<typeof createExtensionProfile>>) {
  let phase: ProgressPhase = 'starting';
  const observedOperations: string[] = [];

  await profile.context.route('https://gql.twitch.tv/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/integrity')) {
      await route.fulfill({ json: { token: 'local-playwright-integrity' } });
      return;
    }

    const body = request.postDataJSON() as
      | GqlQuery
      | readonly GqlQuery[]
      | null;
    if (Array.isArray(body)) {
      observedOperations.push('DropCampaignDetails');
      await route.fulfill({
        json: body.map((query) => {
          const campaign = games.find((game) => game.campaignId === query.variables?.dropID);
          return { data: { user: { dropCampaign: campaign ? campaignRecord(campaign) : null } } };
        }),
      });
      return;
    }

    const query = body as GqlQuery | null;
    const operation = query?.operationName ?? 'unknown';
    observedOperations.push(
      operation === 'DirectoryPage_Game'
        ? `${operation}:${String(query?.variables?.slug ?? 'missing-slug')}`
        : operation,
    );
    switch (operation) {
      case 'ViewerDropsDashboard':
        await route.fulfill({
          json: {
            data: {
              currentUser: {
                dropCampaigns: games.map(campaignRecord),
              },
            },
          },
        });
        return;
      case 'Inventory':
        await route.fulfill({
          json: {
            data: {
              currentUser: {
                inventory: {
                  dropCampaignsInProgress: games.map((game) => ({
                    id: game.campaignId,
                    game: { displayName: game.name, name: game.name },
                    timeBasedDrops: [
                      {
                        id: `drop-${game.campaignId}`,
                        requiredMinutesWatched: 2,
                        endAt: new Date(Date.now() + 86_400_000).toISOString(),
                        self: {
                          currentMinutesWatched: progressFor(game, phase),
                          isClaimed: false,
                          isClaimable: false,
                        },
                      },
                    ],
                  })),
                  gameEventDrops: [],
                },
              },
            },
          },
        });
        return;
      case 'DirectoryPage_Game': {
        const slug = String(query?.variables?.slug ?? '');
        const login = streamers.get(slug);
        await route.fulfill({
          json: {
            data: {
              game: {
                streams: {
                  edges: login
                    ? [
                        {
                          node: {
                            broadcaster: { login, displayName: login },
                            viewersCount: 128,
                            broadcasterLanguage: 'en',
                          },
                        },
                      ]
                    : [],
                },
              },
            },
          },
        });
        return;
      }
      case 'CoreActionsCurrentUser':
        await route.fulfill({ json: { data: { currentUser: { id: '123456789' } } } });
        return;
      default:
        await route.fulfill({ json: { data: {} } });
    }
  });

  await profile.context.route('https://www.twitch.tv/**', async (route) => {
    const channel = new URL(route.request().url()).pathname.split('/').filter(Boolean)[0] ?? '';
    const category = [...streamers.entries()].find(([, login]) => login === channel)?.[0] ?? '';
    const game = games.find((candidate) => candidate.categorySlug === category);
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>${game?.name ?? 'Fixture Stream'} Drops - Twitch</title></head>
        <body><main><h1 data-a-target="stream-title">${game?.name ?? 'Fixture Stream'} Drops</h1>
          <span data-a-target="animated-channel-viewers-count">128 viewers</span>
          <a data-a-target="stream-game-link" href="/directory/category/${category}">${game?.name ?? 'Fixture Game'}</a>
          <div data-a-target="video-player"><video autoplay muted playsinline></video></div>
          <script>
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const drawing = canvas.getContext('2d');
            const draw = () => {
              drawing.fillStyle = '#9147ff';
              drawing.fillRect(0, 0, 16, 16);
              requestAnimationFrame(draw);
            };
            draw();
            const video = document.querySelector('video');
            video.srcObject = canvas.captureStream(5);
            video.play().catch(() => undefined);
          </script>
        </main></body></html>`,
    });
  });

  return {
    setPhase(nextPhase: ProgressPhase) {
      phase = nextPhase;
    },
    observedOperations,
  };
}

async function readAppState(popup: Awaited<ReturnType<typeof openPopup>>) {
  return popup.evaluate(async () => {
    const { appState } = await chrome.storage.local.get('appState');
    return appState as {
      readonly isRunning: boolean;
      readonly selectedGame: FixtureGame | null;
      readonly currentDrop: { readonly currentMinutes: number } | null;
      readonly activeStreamer: { readonly name: string } | null;
      readonly tabId: number | null;
      readonly queue: readonly FixtureGame[];
    };
  });
}

async function runtimeMessage<T>(
  popup: Awaited<ReturnType<typeof openPopup>>,
  message: unknown,
): Promise<T> {
  return popup.evaluate((request) => chrome.runtime.sendMessage(request) as Promise<T>, message);
}

async function refreshCampaigns(popup: Awaited<ReturnType<typeof openPopup>>) {
  await popup.evaluate(async () => {
    const { success, result } = await chrome.runtime.sendMessage({ type: 'OPEN_DROPS_AND_SYNC' });
    if (!success || result?.kind !== 'synced') throw new Error(`Local activation sync failed: ${result?.kind}`);
  });
}

test('completes the first queued campaign and reuses its managed tab for the next one', async () => {
  const profile = await createExtensionProfile();
  try {
    const twitch = await installLocalTwitchFixture(profile);
    await seedAppState(profile, {
      availableGames: games,
      selectedGame: games[0],
      queue: [],
      isRunning: false,
      isPaused: false,
      wasRunning: false,
      autoResumeOnStartup: false,
      autoStartFavoriteGames: false,
      monitorAutoOpen: false,
      watchTransportPreference: 'managed-tab',
      activeStreamer: null,
      tabId: null,
      lastStopReason: null,
      lastStopMessage: null,
    });
    const popup = await openPopup(profile);

    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[1] } });

    const startResult = await runtimeMessage<{ readonly success: boolean; readonly error?: string }>(popup, {
      type: 'START_FARMING',
      payload: { game: games[0] },
    });
    expect(startResult).toEqual({ success: true });
    await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name).toBe('local-stream-one');
    const first = await readAppState(popup);
    expect(first.selectedGame?.campaignId).toBe(games[0]?.campaignId);
    expect(first.queue.map((game) => game.campaignId)).toEqual(games.map((game) => game.campaignId));
    expect(first.tabId).not.toBeNull();
    const originalTabId = first.tabId;

    twitch.setPhase('progressed');
    await refreshCampaigns(popup);
    await expect.poll(async () => (await readAppState(popup)).currentDrop?.currentMinutes).toBe(1);
    expect((await readAppState(popup)).tabId).toBe(originalTabId);

    twitch.setPhase('complete');
    await refreshCampaigns(popup);
    await expect.poll(async () => (await readAppState(popup)).selectedGame?.campaignId).toBe(games[1]?.campaignId);
    const advanced = await readAppState(popup);
    expect(advanced.isRunning).toBe(true);
    expect(advanced.selectedGame?.campaignId).toBe(games[1]?.campaignId);
    expect(advanced.currentDrop?.currentMinutes).toBe(0);
    expect(advanced.tabId).toBe(originalTabId);
    expect(twitch.observedOperations).toContain('DirectoryPage_Game:local-game-two');

    const tabs = await popup.evaluate(() => chrome.tabs.query({ url: ['https://www.twitch.tv/*'] }));
    expect(tabs.filter((tab) => tab.id === originalTabId)).toHaveLength(1);
    expect(tabs.find((tab) => tab.id === originalTabId)?.url).toBe('https://www.twitch.tv/local-stream-two');
  } finally {
    await profile.close();
  }
});

test('shows a failed Pause response in the popup status region', async () => {
  const seedProfile = await createExtensionProfile();
  let profile = seedProfile;
  try {
    await seedAppState(seedProfile, {
      selectedGame: games[0],
      availableGames: games,
      queue: games,
      currentDrop: null,
      pendingDrops: [],
      allDrops: [],
      isRunning: true,
      isPaused: false,
      wasRunning: true,
      autoResumeOnStartup: true,
      autoStartFavoriteGames: false,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      activeStreamer: null,
      tabId: null,
      lastStopReason: null,
      lastStopMessage: null,
    });
    await seedProfile.shutdown();
    profile = await createExtensionProfile(seedProfile.userDataDir);
    const popup = await openPopup(profile);
    const ready = await runtimeMessage<{ readonly success: boolean }>(popup, { type: 'GET_CLAIM_LOG' });
    expect(ready.success).toBe(true);
    const worker = await getExtensionWorker(profile.context);
    await worker.evaluate(() => {
      const storage = chrome.storage.local;
      const originalSet = storage.set.bind(storage);
      Object.defineProperty(globalThis, '__e2eOriginalStorageSet', { value: originalSet, configurable: true });
      Object.defineProperty(storage, 'set', {
        configurable: true,
        value: async (items: Record<string, unknown>) => {
          if ('appState' in items) throw new Error('local fixture persistence failure');
          return originalSet(items);
        },
      });
    });

    await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'local fixture persistence failure' })).toBeVisible();
  } finally {
    await profile.shutdown().catch(() => undefined);
    await seedProfile.close();
  }
});
