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
  ['local-game-one', 'local_stream_one'],
  ['local-game-two', 'local_stream_two'],
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
      case 'StreamInfo': {
        const game = games.find((candidate) => streamers.get(candidate.categorySlug) === query?.variables?.channel);
        await route.fulfill({ json: { data: { user: game ? {
          id: 'fixture-channel', stream: { id: 'fixture-broadcast', type: 'live', game: { id: `campaign-${game.campaignId}`, name: game.name } },
        } : null } } });
        return;
      }
      default:
        await route.fulfill({ json: { data: {} } });
    }
  });

  await profile.context.route('https://www.twitch.tv/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/fixture-spade') {
      await route.fulfill({ status: 204 });
      return;
    }
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
            const fixtureSettings = { "spade_url": "https://www.twitch.tv/fixture-spade" };
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
            const nativePlay = video.play.bind(video);
            video.play = () => sessionStorage.getItem('fixture-playback-authorized') === 'yes'
              ? nativePlay()
              : Promise.reject(new DOMException('Initial interaction required', 'NotAllowedError'));
            video.addEventListener('click', (event) => {
              if (!event.isTrusted) return;
              sessionStorage.setItem('fixture-playback-authorized', 'yes');
              video.play().catch(() => undefined);
            });
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
      readonly currentDrop: { readonly currentMinutes: number; readonly campaignId?: string } | null;
      readonly activeStreamer: { readonly name: string } | null;
      readonly tabId: number | null;
      readonly queue: readonly FixtureGame[];
      readonly isPaused: boolean;
      readonly manualWatchState: string;
      readonly watchTransportMode: string;
      readonly watchHealth: { readonly checkedAt: number; readonly isHealthy: boolean } | null;
      readonly manualQueueAuthorized: boolean;
      readonly recoveryReason: string | null;
      readonly recoveryAttempts: number | null;
      readonly recoveryBackoffUntil: number | null;
      readonly queueAcquisitionRound: { readonly attemptedCampaignKeys: readonly string[]; readonly nextRoundAt: number | null } | null;
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
  test.setTimeout(60_000);
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
    await expect.poll(async () => {
      const state = await readAppState(popup);
      return [state.activeStreamer?.name, typeof state.tabId === 'number'];
    }, { timeout: 30_000 }).toEqual(['local_stream_one', true]);
    const first = await readAppState(popup);
    expect(first.selectedGame?.campaignId).toBe(games[0]?.campaignId);
    expect(first.queue.map((game) => game.campaignId)).toEqual(games.map((game) => game.campaignId));
    expect(first.tabId).not.toBeNull();
    const originalTabId = first.tabId;
    const managedPage = profile.context.pages().find((page) => page.url() === 'https://www.twitch.tv/local_stream_one');
    if (!managedPage) throw new Error('Missing managed stream page');
    await managedPage.locator('video').click();
    const assertPlaying = async () => {
      await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
      const previousTime = await managedPage.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
      await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(previousTime);
    };
    await assertPlaying();
    const removedTabIds: number[] = [];
    await popup.exposeFunction('recordRemovedVideoTab', (id: number) => { removedTabIds.push(id); });
    await popup.evaluate(() => {
      chrome.tabs.onRemoved.addListener((id) => {
        void Reflect.get(globalThis, 'recordRemovedVideoTab')(id);
      });
    });
    const originalDocument = await managedPage.evaluate(() => {
      Reflect.set(globalThis, '__fixtureDocument', 'first-document');
      return Reflect.get(globalThis, '__fixtureDocument');
    });

    twitch.setPhase('progressed');
    await refreshCampaigns(popup);
    await expect.poll(async () => (await readAppState(popup)).currentDrop?.currentMinutes).toBe(1);
    expect((await readAppState(popup)).tabId).toBe(originalTabId);
    const cdp = await profile.context.newCDPSession(popup);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    expect(await runtimeMessage(popup, { type: 'GET_CLAIM_LOG' })).toMatchObject({ success: true });
    expect((await readAppState(popup)).tabId).toBe(originalTabId);
    expect(await managedPage.evaluate(() => Reflect.get(globalThis, '__fixtureDocument'))).toBe(originalDocument);
    await assertPlaying();

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
    expect(tabs.find((tab) => tab.id === originalTabId)?.url).toBe('https://www.twitch.tv/local_stream_two');
    await assertPlaying();
    expect(removedTabIds).not.toContain(originalTabId);
    expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toEqual([managedPage]);
  } finally {
    await profile.close();
  }
});

test('retained managed video does not become manual viewing after switching to hidden farming', async () => {
  test.setTimeout(120_000);
  const profile = await createExtensionProfile();
  try {
    await installLocalTwitchFixture(profile);
    await seedAppState(profile, {
      availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
      autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
      activeStreamer: null, tabId: null,
    });
    const popup = await openPopup(profile);
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
    await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 30_000 }).toBe('local_stream_one');
    await expect.poll(async () => typeof (await readAppState(popup)).tabId, { timeout: 30_000 }).toBe('number');
    const managedPage = profile.context.pages().find((page) => page.url().endsWith('/local_stream_one'));
    if (!managedPage) throw new Error('Missing managed video');
    await managedPage.locator('video').click();
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    expect(await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'tabless' } })).toMatchObject({ success: true });
    await expect.poll(async () => (await readAppState(popup)).tabId).toBeNull();
    const tickAt = ((await readAppState(popup)).watchHealth?.checkedAt ?? 0) + 1;
    const tickPage = await profile.context.newPage();
    let tickAttempt = 0;
    // Tab navigation invokes the same production monitoring listener as the alarm.
    await expect.poll(async () => {
      const checkedAt = (await readAppState(popup)).watchHealth?.checkedAt ?? 0;
      if (checkedAt < tickAt) await tickPage.goto(`https://www.twitch.tv/drops/inventory?tick=${++tickAttempt}`);
      return checkedAt;
    }, { timeout: 75_000, intervals: [6_000] }).toBeGreaterThanOrEqual(tickAt);
    expect(await readAppState(popup)).toMatchObject({ manualWatchState: 'inactive', isRunning: true, watchTransportMode: 'tabless' });
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);

    // A real personal stream must still take precedence, including in a background tab.
    const personalPage = await profile.context.newPage();
    await personalPage.goto('https://www.twitch.tv/local_stream_two');
    await personalPage.locator('video').click();
    await popup.bringToFront();
    await expect.poll(async () => {
      await tickPage.goto(`https://www.twitch.tv/drops/inventory?personal=${++tickAttempt}`);
      return (await readAppState(popup)).manualWatchState;
    }, { timeout: 30_000, intervals: [2_000] }).toBe('automation-paused');
    await personalPage.close();
    await expect.poll(async () => {
      await tickPage.goto(`https://www.twitch.tv/drops/inventory?resume=${++tickAttempt}`);
      return (await readAppState(popup)).manualWatchState;
    }, { timeout: 30_000, intervals: [2_000] }).toBe('inactive');
  } finally {
    await profile.close();
  }
});

test('stalled rounds retain one authorized video tab and replace it only after actual closure', async () => {
  test.setTimeout(360_000);
  const profile = await createExtensionProfile();
  try {
    await installLocalTwitchFixture(profile);
    await seedAppState(profile, { availableGames: games, selectedGame: games[0], queue: games,
      isRunning: false, isPaused: false, autoStartFavoriteGames: false, monitorAutoOpen: false,
      watchTransportPreference: 'managed-tab', activeStreamer: null, tabId: null });
    const popup = await openPopup(profile);
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[1] } });
    expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
    await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 30_000 }).toBe('local_stream_one');
    const originalTabId = (await readAppState(popup)).tabId;
    const managedPage = profile.context.pages().find((page) => page.url().endsWith('/local_stream_one'));
    if (!managedPage) throw new Error('Missing managed video tab');
    await managedPage.locator('video').click();

    // A Twitch tab update drives the real monitoring listener, including missed alarms.
    // Only wall-clock time is accelerated; attempt budgets and playback stay unchanged.
    const tickPage = await profile.context.newPage();
    await tickPage.goto('https://www.twitch.tv/drops/inventory');
    let clockStep = 0;
    let wallOffset = 0;
    const advanceAndTick = async (milliseconds: number) => {
      wallOffset += milliseconds;
      const worker = await getExtensionWorker(profile.context);
      const target = await worker.evaluate(async (offset) => {
        if (!Reflect.has(globalThis, '__roundClock')) {
          const realNow = Date.now.bind(Date);
          const clock = { realNow, offset: 0 };
          Reflect.set(globalThis, '__roundClock', clock);
          Date.now = () => clock.realNow() + clock.offset;
          // Observe the existing tick/acquisition watchdogs without changing timers.
          // A heartbeat can be saved before playback acquisition has finished.
          const operations = new Set<ReturnType<typeof setTimeout>>();
          Reflect.set(globalThis, '__roundOperations', operations);
          const schedule = globalThis.setTimeout.bind(globalThis);
          const cancel = globalThis.clearTimeout.bind(globalThis);
          Reflect.set(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
            const timer = schedule(() => { operations.delete(timer); callback(...args); }, delay);
            if (delay === 60_000) operations.add(timer);
            return timer;
          });
          Reflect.set(globalThis, 'clearTimeout', (timer: ReturnType<typeof setTimeout>) => {
            operations.delete(timer);
            cancel(timer);
          });
        }
        const clock = Reflect.get(globalThis, '__roundClock') as { realNow: () => number; offset: number };
        clock.offset = offset;
        return Date.now();
      }, wallOffset);
      await tickPage.goto(`https://www.twitch.tv/drops/inventory?clock=${++clockStep}`);
      if (!(await readAppState(popup)).isRunning) return;
      await expect.poll(async () => {
        const heartbeat = await popup.evaluate(async () => {
          const { timingState } = await chrome.storage.local.get('timingState');
          return timingState && typeof timingState === 'object' && 'lastHeartbeatAt' in timingState
            && typeof timingState.lastHeartbeatAt === 'number' ? timingState.lastHeartbeatAt : 0;
        });
        if (heartbeat < target) await tickPage.goto(`https://www.twitch.tv/drops/inventory?clock=${++clockStep}`);
        return heartbeat;
      }, { timeout: 30_000, intervals: [6_000] }).toBeGreaterThanOrEqual(target);
      await expect.poll(() => worker.evaluate(() =>
        (Reflect.get(globalThis, '__roundOperations') as Set<ReturnType<typeof setTimeout>>).size),
        { timeout: 30_000 }).toBe(0);
    };
    for (let round = 0; round < 2; round += 1) {
      for (let campaign = 0; campaign < games.length; campaign += 1) {
        const expectedCampaign = games[campaign]?.campaignId;
        await expect.poll(async () => (await readAppState(popup)).selectedGame?.campaignId, { timeout: 25_000 }).toBe(expectedCampaign);
        // Each new watch needs an inventory baseline before its stall window begins.
        await advanceAndTick(6 * 60_000);
        await expect.poll(async () => (await readAppState(popup)).currentDrop?.campaignId).toBe(expectedCampaign);
        await expect.poll(() => popup.evaluate(async (campaignId) => {
          const { timingState } = await chrome.storage.local.get('timingState');
          return timingState && typeof timingState === 'object' && 'lastTrackedDropKey' in timingState
            && typeof timingState.lastTrackedDropKey === 'string' && timingState.lastTrackedDropKey.includes(campaignId ?? '');
        }, expectedCampaign), { timeout: 15_000, intervals: [6_000] }).toBe(true);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const before = await readAppState(popup);
          const previousAttempts = before.recoveryReason === 'stalled-progress' ? (before.recoveryAttempts ?? 0) : 0;
          await advanceAndTick(previousAttempts === 0 ? 25 * 60_000 : 61_000);
          await expect.poll(async () => {
            const state = await readAppState(popup);
            return (previousAttempts < 3 && state.recoveryAttempts === previousAttempts + 1) ||
              state.queueAcquisitionRound?.attemptedCampaignKeys.includes(`campaign:${expectedCampaign}`);
          }, { timeout: 25_000 }).toBe(true);
          if ((await readAppState(popup)).queueAcquisitionRound?.attemptedCampaignKeys.includes(`campaign:${expectedCampaign}`)) break;
        }
        expect((await readAppState(popup)).queueAcquisitionRound?.attemptedCampaignKeys).toContain(`campaign:${expectedCampaign}`);
        expect((await readAppState(popup)).tabId).toBe(originalTabId);
      }
      await expect.poll(async () => (await readAppState(popup)).queueAcquisitionRound?.nextRoundAt).not.toBeNull();
      const waiting = await readAppState(popup);
      expect(waiting.isRunning).toBe(true);
      expect(waiting.manualQueueAuthorized).toBe(true);
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
      expect(waiting.queueAcquisitionRound?.attemptedCampaignKeys).toHaveLength(2);
      const roundDeadline = waiting.queueAcquisitionRound?.nextRoundAt;
      if (roundDeadline == null) throw new Error('Missing round deadline');
      const workerNow = Date.now() + wallOffset;
      await advanceAndTick(Math.max(0, roundDeadline - workerNow - 60_000));
      await expect.poll(async () => (await readAppState(popup)).queueAcquisitionRound?.nextRoundAt).toBe(waiting.queueAcquisitionRound?.nextRoundAt);
      await advanceAndTick(60_001);
      await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 25_000 }).toBe('local_stream_one');
      expect((await readAppState(popup)).tabId).toBe(originalTabId);
      await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    }
    await managedPage.close();
    await advanceAndTick(61_000);
    await expect.poll(async () => (await readAppState(popup)).tabId, { timeout: 25_000 }).not.toBeNull();
    const replacement = (await readAppState(popup)).tabId;
    expect(replacement).not.toBe(originalTabId);
    expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toHaveLength(1);
    await runtimeMessage(popup, { type: 'STOP_FARMING' });
    await profile.context.pages().find((page) => /\/local_stream_(one|two)$/.test(page.url()))?.close();
    await advanceAndTick(25 * 60_000);
    expect((await readAppState(popup)).isRunning).toBe(false);
    expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toHaveLength(0);
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
