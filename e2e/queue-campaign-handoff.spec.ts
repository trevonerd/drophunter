import { expect, test } from '@playwright/test';
import {
  createExtensionProfile,
  getExtensionWorker,
  openPopup,
  seedAppState,
} from './extension-fixture';
import { twitchFixtureRouter } from './twitch-fixture-router';

type FixtureGame = {
  id: string;
  categoryId: string;
  campaignId: string;
  name: string;
  categorySlug: string;
  imageUrl: string;
  dropCount: number;
};

const games: FixtureGame[] = [
  {
    id: 'e2e-game-one',
    categoryId: 'e2e-category-one',
    campaignId: 'e2e-campaign-one',
    name: 'Local Game One',
    categorySlug: 'local-game-one',
    imageUrl: '',
    dropCount: 1,
  },
  {
    id: 'e2e-game-two',
    categoryId: 'e2e-category-two',
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
      id: game.categoryId,
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
  const eligibleStreamers = new Map(streamers);
  let phase: ProgressPhase = 'starting';
  const failedChannels = new Set<string>();
  const channelsWithoutDropsSignal = new Set<string>();
  const channelsRequiringGesture = new Set<string>();
  const channelsWithDeferredCategory = new Set<string>();
  const channelsPausingUntilGesture = new Set<string>();
  const channelsWithSupportedPlayControl = new Set<string>();
  const delayedPlayers = new Set<string>();
  const heldPlaybackResponses = new Map<string, {
    requested: ReturnType<typeof Promise.withResolvers<void>>;
    release: ReturnType<typeof Promise.withResolvers<void>>;
  }>();
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
                    game: { id: game.categoryId, displayName: game.name, name: game.name },
                    timeBasedDrops: [
                      {
                        id: `drop-${game.campaignId}`,
                        requiredMinutesWatched: 2,
                        endAt: new Date(Date.now() + 86_400_000).toISOString(),
                        self: {
                          currentMinutesWatched: progressFor(game, phase),
                          isClaimed: phase === 'complete' && game.campaignId === games[0]?.campaignId,
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
        const login = eligibleStreamers.get(slug);
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
        const game = games.find((candidate) => eligibleStreamers.get(candidate.categorySlug) === query?.variables?.channel);
        await route.fulfill({ json: { data: { user: game ? {
          id: 'fixture-channel', stream: { id: 'fixture-broadcast', type: 'live', game: { id: game.categoryId, name: game.name } },
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
    const held = heldPlaybackResponses.get(channel);
    if (held) {
      held.requested.resolve();
      await held.release.promise;
      heldPlaybackResponses.delete(channel);
    }
    if (failedChannels.has(channel)) {
      await route.fulfill({ status: 200, contentType: 'text/html', body:
        `<html><body><main><a href="/${channel}"><h1>${channel}</h1></a>
          <div data-a-target="video-player"><video muted playsinline></video>Playback unavailable</div>
          <script>document.querySelector('video').play = () =>
            Promise.reject(new DOMException('Unsupported fixture playback', 'NotSupportedError'));</script>
        </main></body></html>` });
      return;
    }
    const category = [...eligibleStreamers.entries()].find(([, login]) => login === channel)?.[0] ?? '';
    const game = games.find((candidate) => candidate.categorySlug === category);
    const dropsLabel = channelsWithoutDropsSignal.has(channel) ? '' : ' Drops';
    const sitePause = channelsPausingUntilGesture.has(channel);
    const supportedPlayControl = channelsWithSupportedPlayControl.has(channel);
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>${game?.name ?? 'Fixture Stream'}${dropsLabel} - Twitch</title></head>
        <body><main><a href="/${channel}"><h1>${channel}</h1></a>
          <h2 data-a-target="stream-title">${game?.name ?? 'Fixture Stream'}${dropsLabel}</h2>
          <span data-a-target="animated-channel-viewers-count">128 viewers</span>
          <a data-a-target="stream-game-link" href="/directory/category/${category}">${game?.name ?? 'Fixture Game'}</a>
          <div data-a-target="video-player"><video muted playsinline></video></div>
          <button data-a-target="player-play-pause-button" data-a-player-state="paused">Play</button>
          <script>
            ${twitchFixtureRouter}
            const fixtureSettings = { "spade_url": "https://www.twitch.tv/fixture-spade" };
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const drawing = canvas.getContext('2d');
            const draw = () => {
              drawing.fillStyle = '#9147ff';
              drawing.fillRect(0, 0, 16, 16);
            };
            draw();
            setInterval(draw, 100);
            const video = document.querySelector('video');
            const categoryLink = document.querySelector('[data-a-target="stream-game-link"]');
            if (${JSON.stringify(channelsWithDeferredCategory.has(channel))}) {
              categoryLink.remove();
              video.addEventListener('playing', () => document.querySelector('main').append(categoryLink), { once: true });
            }
            if (${JSON.stringify(delayedPlayers.has(channel))}) {
              video.remove();
              setTimeout(() => document.querySelector('[data-a-target="video-player"]').append(video), 2_000);
            }
            const nativePlay = video.play.bind(video);
            video.play = () => !${JSON.stringify(channelsRequiringGesture.has(channel))} || sessionStorage.getItem('fixture-playback-authorized') === 'yes'
              ? nativePlay()
              : Promise.reject(new DOMException(${JSON.stringify(sitePause ? 'The play() request was interrupted by a call to pause().' : 'Initial interaction required')}, ${JSON.stringify(sitePause ? 'AbortError' : 'NotAllowedError')}));
            let sitePlayingIntent = false;
            const authorizePlayback = (event) => {
              if (event.currentTarget === playControl && playControl.dataset.aPlayerState === 'playing') {
                sitePlayingIntent = false;
                playControl.dataset.aPlayerState = 'paused';
                playControl.textContent = 'Play';
                video.dataset.fixtureExplicitPauseClicks = String(Number(video.dataset.fixtureExplicitPauseClicks ?? 0) + 1);
                video.pause();
                return;
              }
              if (!event.isTrusted && (!${JSON.stringify(supportedPlayControl)} || event.currentTarget !== playControl)) return;
              if (event.currentTarget === playControl) video.dataset.fixtureExplicitPlayClicks = String(Number(video.dataset.fixtureExplicitPlayClicks ?? 0) + 1);
              sessionStorage.setItem('fixture-playback-authorized', 'yes');
              video.dataset.fixturePlaybackAuthorized = 'yes';
              video.play().catch(() => undefined);
            };
            video.addEventListener('click', authorizePlayback);
            const playControl = document.querySelector('button[data-a-target="player-play-pause-button"]');
            playControl?.addEventListener('click', authorizePlayback);
            video.addEventListener('playing', () => {
              sitePlayingIntent = true;
              if (playControl) { playControl.dataset.aPlayerState = 'playing'; playControl.textContent = 'Pause'; }
            });
            video.addEventListener('pause', () => {
              if (sitePlayingIntent) queueMicrotask(() => video.play().catch(() => undefined));
            });
            video.srcObject = canvas.captureStream(5);
            video.play().catch(() => undefined);
          </script>
        </main></body></html>`,
    });
  });

  return {
    setAvailableStreamer(categorySlug: string, channel: string | null) {
      if (channel) eligibleStreamers.set(categorySlug, channel);
      else eligibleStreamers.delete(categorySlug);
    },
    delayPlayer(channel: string) {
      delayedPlayers.add(channel);
    },
    holdPlaybackResponse(channel: string) {
      const held = { requested: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      heldPlaybackResponses.set(channel, held);
      return { requested: held.requested.promise, release: () => held.release.resolve() };
    },
    requireUserGesture(channel: string, sitePause = false) {
      channelsRequiringGesture.add(channel);
      if (sitePause) channelsPausingUntilGesture.add(channel);
    },
    deferCategoryUntilPlayback(channel: string) {
      channelsWithDeferredCategory.add(channel);
    },
    supportTwitchPlayControl(channel: string) {
      channelsRequiringGesture.add(channel);
      channelsPausingUntilGesture.add(channel);
      channelsWithSupportedPlayControl.add(channel);
    },
    failPlayback(channel: string) {
      failedChannels.add(channel);
    },
    hideDropsSignal(channel: string) {
      channelsWithoutDropsSignal.add(channel);
    },
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
      readonly pendingWatchTarget: { readonly channelName: string } | null;
      readonly tabId: number | null;
      readonly queue: readonly FixtureGame[];
      readonly isPaused: boolean;
      readonly manualWatchState: string;
      readonly watchTransportMode: string;
      readonly watchHealth: { readonly checkedAt: number; readonly isHealthy: boolean; readonly reason: string } | null;
      readonly manualQueueAuthorized: boolean;
      readonly recoveryReason: string | null;
      readonly recoveryAttempts: number | null;
      readonly recoveryBackoffUntil: number | null;
      readonly queueEntryMetadataByKey: Readonly<Record<string, { readonly attemptedStreamerNames?: readonly string[]; readonly watchAttempt?: { readonly observedAt: number }; readonly streamerRetryReason?: string }>>;
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

async function captureAttentionNotifications(profile: Awaited<ReturnType<typeof createExtensionProfile>>) {
  const worker = await getExtensionWorker(profile.context);
  await worker.evaluate(() => {
    const captured: chrome.notifications.NotificationCreateOptions[] = [];
    Reflect.set(globalThis, '__fixtureAttentionNotifications', captured);
    const contains = chrome.permissions.contains.bind(chrome.permissions);
    const request = chrome.permissions.request.bind(chrome.permissions);
    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value: (permission: chrome.permissions.Permissions) =>
        permission.permissions?.includes('notifications') ? Promise.resolve(true) : contains(permission),
    });
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: (permission: chrome.permissions.Permissions) =>
        permission.permissions?.includes('notifications') ? Promise.resolve(true) : request(permission),
    });
    Object.defineProperty(chrome, 'notifications', {
      configurable: true,
      value: {
        create: async (id: string | chrome.notifications.NotificationCreateOptions, options?: chrome.notifications.NotificationCreateOptions) => {
          const notification = typeof id === 'string' ? options : id;
          if (notification) captured.push(notification);
          return typeof id === 'string' ? id : 'fixture-notification';
        },
        onClicked: { addListener: () => {} },
        onButtonClicked: { addListener: () => {} },
      },
    });
    const resolvedBrowser = Reflect.get(globalThis, 'browser');
    if (resolvedBrowser && resolvedBrowser !== chrome) {
      // WXT's browser API can cache its notification surface independently of
      // chrome; capture the same API the extension resolves at delivery time.
      Object.defineProperty(resolvedBrowser, 'notifications', { configurable: true, value: chrome.notifications });
    }
  });
  return () => worker.evaluate(async () => {
    const notifications: unknown = Reflect.get(globalThis, '__fixtureAttentionNotifications');
    const titles = Array.isArray(notifications) ? notifications.map((notification) => notification.title) : [];
    const count = titles.filter((title) => title === 'DropHunter needs your attention').length;
    if (count > 0) return count;
    const { appState, automationNotificationTransitions } = await chrome.storage.local.get(['appState', 'automationNotificationTransitions']);
    const state = appState as { notificationsEnabled?: boolean; watchHealth?: unknown } | undefined;
    return { count, titles, enabled: state?.notificationsEnabled, health: state?.watchHealth, receipts: automationNotificationTransitions };
  });
}

async function assertCurrentManagedPlayback(
  profile: Awaited<ReturnType<typeof createExtensionProfile>>,
  popup: Awaited<ReturnType<typeof openPopup>>,
  channel: string,
) {
  await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 30_000 }).toBe(channel);
  const state = await readAppState(popup);
  const expectedUrl = `https://www.twitch.tv/${channel}`;
  expect(state.activeStreamer?.name).toBe(channel);
  expect(state.currentDrop?.campaignId).toBe(state.selectedGame?.campaignId);
  expect(typeof state.tabId).toBe('number');
  const tabs = await popup.evaluate(() => chrome.tabs.query({ url: ['https://www.twitch.tv/*'] }));
  expect(tabs.find((tab) => tab.id === state.tabId)?.url).toBe(expectedUrl);
  expect(tabs.filter((tab) => /\/local_stream_(one|two)$/.test(tab.url ?? ''))).toHaveLength(1);
  const page = profile.context.pages().find((candidate) => candidate.url() === expectedUrl);
  if (!page) throw new Error('Missing promoted managed video');
  const marker = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__drophunter_managed_watch_v1') ?? 'null'));
  expect(marker).toMatchObject({ version: 1, expectedUrl });
  expect(typeof marker.ownershipToken).toBe('string');
  expect(marker.ownershipToken.length).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
  const previousTime = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(previousTime);
  const context = await popup.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' }), state.tabId as number);
  expect(context.context).toMatchObject({ channelName: channel, isPlaybackReady: true });
  return page;
}

for (const sameCampaign of [true, false]) {
  test(`offline farming ${sameCampaign ? 'rotates its streamer' : 'continues to the next campaign'} in the same unfocused tab`, async () => {
    test.setTimeout(90_000);
    const profile = await createExtensionProfile();
    try {
      const twitch = await installLocalTwitchFixture(profile);
      await seedAppState(profile, { availableGames: games, selectedGame: games[0], queue: [],
        isRunning: false, isPaused: false, autoStartFavoriteGames: false, monitorAutoOpen: false,
        watchTransportPreference: 'managed-tab', activeStreamer: null, tabId: null });
      const popup = await openPopup(profile);
      await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
      await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
      for (const game of games) await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game } });
      expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
      const page = await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');
      const original = await readAppState(popup);
      const nextChannel = sameCampaign ? 'local_stream_replacement' : 'local_stream_two';
      const nextGame = games[sameCampaign ? 0 : 1]!;
      twitch.setAvailableStreamer('local-game-one', sameCampaign ? nextChannel : null);
      const held = twitch.holdPlaybackResponse(nextChannel);
      const monitor = await profile.context.newPage();
      await monitor.goto(`${profile.extensionUrl}/monitor.html`);
      const tickPage = await profile.context.newPage();
      let tick = 0;
      await page.evaluate(() => {
        const gate = document.createElement('div');
        gate.setAttribute('data-a-target', 'player-overlay-content-gate-offline');
        gate.textContent = 'This channel is offline';
        document.querySelector('[data-a-target="video-player"]')?.append(gate);
        document.querySelector<HTMLButtonElement>('[data-a-target="player-play-pause-button"]')?.click();
      });
      await expect.poll(async () => {
        await tickPage.goto(`https://www.twitch.tv/drops/inventory?offline=${++tick}`);
        const state = await readAppState(popup);
        return state.pendingWatchTarget?.channelName ?? JSON.stringify({ health: state.watchHealth,
          recovery: state.recoveryReason, streamer: state.activeStreamer, running: state.isRunning,
          manualWatch: state.manualWatchState, round: state.queueAcquisitionRound });
      }, { timeout: 60_000, intervals: [2_000] }).toBe(nextChannel);
      await held.requested;
      await expect(popup.getByText(`Switching to · ${nextGame.name}`, { exact: false })).toBeVisible();
      await expect(popup.getByRole('list', { name: 'Remaining campaign drops' })).toBeHidden();
      await expect(monitor.getByText(nextGame.name, { exact: true })).toBeVisible();
      await expect(monitor.getByRole('progressbar')).toHaveCount(0);
      held.release();
      await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 30_000 }).toBe(nextChannel);
      const current = await readAppState(popup);
      expect(current.tabId).toBe(original.tabId);
      expect(current.selectedGame?.campaignId).toBe(nextGame.campaignId);
      expect(current.currentDrop?.campaignId).toBe(nextGame.campaignId);
      expect(current.watchHealth?.isHealthy).toBe(true);
      expect(current.isRunning).toBe(true);
      expect(profile.context.pages().filter((candidate) => /\/local_stream_/.test(candidate.url()))).toEqual([page]);
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
      const startedAt = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(startedAt);
      expect(await popup.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).active, original.tabId!)).toBe(false);
    } finally { await profile.close(); }
  });
}

for (const gestureMode of ['autoplay', 'gesture', 'gesture-without-category', 'site-pause', 'site-control'] as const) {
  const gesture = gestureMode === 'gesture' || gestureMode === 'gesture-without-category' || gestureMode === 'site-pause';
  test(`managed farming ${gestureMode === 'gesture-without-category' ? 'retains a gesture-blocked player before Twitch renders its category with local guidance' : gestureMode === 'site-control' ? 'starts through the paused Twitch Play control without user focus or clicks' : gestureMode === 'site-pause' ? 'retains its Twitch pause-blocked initial video and resumes after Play' : gesture ? 'retains its initial gesture-blocked video and resumes after Play' : 'advances video and Twitch progress without clicking or focusing its tab'}`, async () => {
    test.setTimeout(100_000);
    const profile = await createExtensionProfile();
    try {
      const twitch = await installLocalTwitchFixture(profile);
      const attentionCount = gesture ? await captureAttentionNotifications(profile) : null;
      if (gesture) twitch.requireUserGesture('local_stream_one', gestureMode === 'site-pause');
      if (gestureMode === 'gesture-without-category') twitch.deferCategoryUntilPlayback('local_stream_one');
      if (gestureMode === 'site-control') twitch.supportTwitchPlayControl('local_stream_one');
      await seedAppState(profile, {
        availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
        autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
        activeStreamer: null, tabId: null, notificationsEnabled: gesture,
      });
      const popup = await openPopup(profile);
      await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
      if (gesture) expect(await runtimeMessage(popup, { type: 'SET_NOTIFICATIONS_ENABLED', payload: { enabled: true } })).toMatchObject({ success: true });
      await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
      await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
      await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
      if (gestureMode !== 'autoplay') {
        const worker = await getExtensionWorker(profile.context);
        await worker.evaluate((sitePause) => {
          // Install the policy fixture in the extension's isolated world so the
          // real content play() call sees the browser-style NotAllowedError.
          const sendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
          Object.defineProperty(chrome.tabs, 'sendMessage', { value: async (tabId: number, message: unknown, options?: chrome.tabs.MessageSendOptions) => {
            if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'PREPARE_STREAM_PLAYBACK') {
              await chrome.scripting.executeScript({
                target: { tabId },
                args: [sitePause],
                func: async (pausedBySite: boolean) => {
                  let video = document.querySelector<HTMLVideoElement>('video');
                  for (let checks = 0; !video && checks < 100; checks++) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    video = document.querySelector<HTMLVideoElement>('video');
                  }
                  if (!video) throw new Error('The local playback policy fixture has no video.');
                  if (video.dataset.fixturePolicyInstalled === 'yes') return;
                  video.dataset.fixturePolicyInstalled = 'yes';
                  video.pause();
                  const play = video.play.bind(video);
                  video.play = () => video.dataset.fixturePlaybackAuthorized === 'yes'
                    ? play()
                    : Promise.reject(new DOMException(pausedBySite ? 'The play() request was interrupted by a call to pause().' : 'User activation required', pausedBySite ? 'AbortError' : 'NotAllowedError'));
                },
              });
            }
            return sendMessage(tabId, message, options ?? {});
          } });
        }, gestureMode === 'site-pause' || gestureMode === 'site-control');
      }
      expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
      await expect.poll(async () => {
        const state = await readAppState(popup);
        return state.activeStreamer?.name === 'local_stream_one' ? 'local_stream_one' : JSON.stringify({
          selected: state.selectedGame, metadata: state.queueEntryMetadataByKey, recovery: state.recoveryReason,
          episodes: Reflect.get(state, 'campaignFailureEpisodesByKey'), tabs: profile.context.pages().map((page) => page.url()),
        });
      }, { timeout: 30_000 }).toBe('local_stream_one');
      await expect.poll(() => profile.context.pages().some((candidate) => candidate.url().endsWith('/local_stream_one'))).toBe(true);
      const page = profile.context.pages().find((candidate) => candidate.url().endsWith('/local_stream_one'));
      if (!page) throw new Error('Missing retained managed video');
      const original = await readAppState(popup);
      if (gestureMode === 'site-control') {
        expect(original.watchHealth?.reason).not.toBe('user-interaction-required');
        expect(await page.locator('video').getAttribute('data-fixture-explicit-play-clicks')).toBe('1');
      }
      if (gesture) {
        expect(original.watchHealth?.reason).toBe('user-interaction-required');
        await expect(popup.getByText(/Start the video/)).toBeVisible();
        expect(original.queueAcquisitionRound).toBeNull();
        expect(original.recoveryReason).toBeNull();
        if (attentionCount) expect(await attentionCount()).toMatchObject({ count: 0 });
        if (gestureMode === 'site-pause') await page.getByRole('button', { name: 'Play', exact: true }).click();
        else await page.locator('video').click();
      }
      const previousTime = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(previousTime);
      // Exercise the real content context, not a mocked playback-ready heartbeat.
      await expect.poll(() => popup.evaluate(async (tabId) => {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' });
        return result.context?.isPlaybackReady;
      }, original.tabId as number)).toBe(true);
      twitch.setPhase('progressed');
      await refreshCampaigns(popup);
      await expect.poll(async () => (await readAppState(popup)).currentDrop?.currentMinutes).toBe(1);
      expect((await readAppState(popup)).tabId).toBe(original.tabId);
      expect((await readAppState(popup)).selectedGame?.campaignId).toBe(games[0]?.campaignId);
      if (gesture) await expect(popup.getByText(/Start the video/)).toBeHidden({ timeout: 70_000 });
      if (attentionCount) expect(await attentionCount()).toMatchObject({ count: 0 });
    } finally {
      await profile.close();
    }
  });
}

for (const scenario of ['ready', 'failed', 'failed-without-incumbent-signal', 'missing-signal', 'delayed-player'] as const) {
  const candidateFails = scenario === 'failed' || scenario === 'failed-without-incumbent-signal';
  test(`queue Play ${scenario === 'failed-without-incumbent-signal' ? 'parks a failed request and returns to the next campaign without a Drops label' : candidateFails ? 'parks failed playback and resumes the next queued campaign in the same tab' : scenario === 'missing-signal' ? 'switches to a verified campaign without a DOM Drops signal' : scenario === 'delayed-player' ? 'waits for the Twitch player to mount without skipping the requested campaign' : 'switches to a freshly verified campaign'}`, async () => {
    test.setTimeout(candidateFails ? 180_000 : 120_000);
    const profile = await createExtensionProfile();
    try {
      const twitch = await installLocalTwitchFixture(profile);
      if (scenario === 'failed-without-incumbent-signal') twitch.hideDropsSignal('local_stream_one');
      await seedAppState(profile, {
        availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
        autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
        activeStreamer: null, tabId: null,
      });
      const popup = await openPopup(profile);
      await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
      await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
      for (const game of games) await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game } });
      expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
      await expect.poll(async () => {
        const state = await readAppState(popup);
        return state.activeStreamer?.name === 'local_stream_one' ? 'local_stream_one' : JSON.stringify({
          selected: state.selectedGame, metadata: state.queueEntryMetadataByKey, recovery: state.recoveryReason,
          episodes: Reflect.get(state, 'campaignFailureEpisodesByKey'), tabs: profile.context.pages().map((page) => page.url()),
        });
      }, { timeout: 30_000 }).toBe('local_stream_one');
      const original = await readAppState(popup);
      const managedPage = profile.context.pages().find((page) => page.url().endsWith('/local_stream_one'));
      if (!managedPage) throw new Error('Missing managed watch');
      const originalDocument = await managedPage.evaluate(() => {
        const sentinel = crypto.randomUUID();
        Reflect.set(globalThis, '__fixtureQueuePlayDocument', sentinel);
        return sentinel;
      });
      await managedPage.locator('video').click();
      await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
      const heldReplacement = candidateFails || scenario === 'ready'
        ? twitch.holdPlaybackResponse('local_stream_two') : null;
      if (candidateFails) twitch.failPlayback('local_stream_two');
      if (scenario === 'missing-signal') twitch.hideDropsSignal('local_stream_two');
      if (scenario === 'delayed-player') twitch.delayPlayer('local_stream_two');
      const operationsBefore = twitch.observedOperations.length;
      const playButton = popup.getByRole('button', { name: /^Start Local Game Two.* now$/ });
      const switching = playButton.click();
      if (heldReplacement) {
        await heldReplacement.requested;
        try {
          await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
          await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
          expect((await readAppState(popup)).tabId).toBeNull();
          expect((await readAppState(popup)).selectedGame?.campaignId).toBe(games[1]?.campaignId);
          expect((await readAppState(popup)).activeStreamer).toBeNull();
          expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toHaveLength(1);
          expect(profile.context.pages()).toContain(managedPage);
          await expect(managedPage).toHaveURL('https://www.twitch.tv/local_stream_two');
          await expect(managedPage.locator('main h1')).toHaveText('local_stream_one');
          expect((await readAppState(popup)).pendingWatchTarget?.channelName).toBe('local_stream_two');
          expect(await managedPage.evaluate(() => Reflect.get(globalThis, '__fixtureQueuePlayDocument'))).toBe(originalDocument);
        } finally {
          heldReplacement.release();
        }
      }
      await switching;
      if (candidateFails) {
        await expect.poll(async () => {
          const state = await readAppState(popup);
          return {
            campaignId: state.selectedGame?.campaignId,
            streamer: state.activeStreamer?.name,
            metadata: state.queueEntryMetadataByKey,
          };
        }, { timeout: 100_000 }).toMatchObject({ campaignId: games[0]?.campaignId, streamer: 'local_stream_one' });
      } else {
        await expect.poll(async () => {
          const state = await readAppState(popup);
          return state.activeStreamer?.name === 'local_stream_two' ? 'local_stream_two' : state;
        }, { timeout: 30_000 }).toBe('local_stream_two');
      }
      await expect.poll(async () => (await readAppState(popup)).selectedGame?.campaignId).toBe(games[candidateFails ? 0 : 1]?.campaignId);
      const after = await readAppState(popup);
      expect(after.isRunning).toBe(true);
      if (candidateFails) {
        expect(after.tabId).toBe(original.tabId);
        if (scenario === 'failed-without-incumbent-signal') {
          const observation = await popup.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' }), original.tabId as number);
          expect(observation.context).toMatchObject({ isPlaybackReady: true, hasDropsSignal: false });
          expect(after.watchHealth?.isHealthy || ['heartbeat', 'drops-inactive'].includes(after.watchHealth?.reason ?? '')).toBe(true);
        } else expect(after.watchHealth?.isHealthy).toBe(true);
      }
      expect(after.tabId).toBe(original.tabId);
      expect(await managedPage.evaluate(() => Reflect.get(globalThis, '__fixtureQueuePlayDocument'))).toBe(originalDocument);
      expect(await managedPage.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
      const targetChannel = candidateFails ? 'local_stream_one' : 'local_stream_two';
      await expect(managedPage.locator('main h1')).toHaveText(targetChannel);
      await expect(managedPage.locator('main h1').locator('..')).toHaveAttribute('href', `/${targetChannel}`);
      await expect(managedPage.locator('[data-a-target="stream-game-link"]')).toHaveAttribute(
        'href', `/directory/category/${games[candidateFails ? 0 : 1]?.categorySlug}`,
      );
      expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toEqual([managedPage]);
      expect(after.activeStreamer?.name).toBe(candidateFails ? 'local_stream_one' : 'local_stream_two');
      const playOperations = twitch.observedOperations.slice(operationsBefore);
      expect(playOperations).toContain('DirectoryPage_Game:local-game-two');
      // Start records intent only. Normal monitoring may refresh inventory and
      // campaigns while acquiring or retrying the requested watch.
      if (candidateFails) expect(Object.values(after.queueEntryMetadataByKey)
        .some((metadata) => metadata.streamerRetryReason === 'open-failed' || metadata.streamerRetryReason === 'no-streamers')).toBe(true);
      await assertCurrentManagedPlayback(profile, popup, candidateFails ? 'local_stream_one' : 'local_stream_two');
    } finally {
      await profile.close();
    }
  });
}

for (const restoreContext of ['healthy', 'missing-category'] as const) {
test(`Pause Resume and Stop suspend the actual retained player across worker recycle with ${restoreContext} context`, async () => {
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
    await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
    await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } });
    const managedPage = await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');
    const tabId = (await readAppState(popup)).tabId;
    await popup.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(await managedPage.evaluate(() => document.documentElement.dataset.drophunterKeepalive)).toBeUndefined();
    await expect(managedPage.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('data-a-player-state', 'paused');
    await popup.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    expect((await readAppState(popup)).tabId).toBe(tabId);
    if (restoreContext === 'missing-category') {
      await managedPage.locator('a[href*="/directory/category/"]').evaluateAll((links) => links.forEach((link) => link.remove()));
    }
    const cdp = await profile.context.newCDPSession(popup);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    await runtimeMessage(popup, { type: 'GET_STATE' });
    await popup.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(await managedPage.evaluate(() => document.documentElement.dataset.drophunterKeepalive)).toBeUndefined();
    await expect(managedPage.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('data-a-player-state', 'paused');
    expect((await readAppState(popup)).isRunning).toBe(false);
    expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toEqual([managedPage]);
  } finally { await profile.close(); }
});
}

test('Stop pauses a retained failed player even when the user restarts its video', async () => {
  test.setTimeout(90_000);
  const profile = await createExtensionProfile();
  try {
    await installLocalTwitchFixture(profile);
    await profile.context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        if (location.pathname !== '/local_stream_one') return;
        const category = document.querySelector('a[data-a-target="stream-game-link"]');
        category?.setAttribute('href', '/directory/category/wrong-game');
        if (category) category.textContent = 'Wrong game';
      });
    });
    await seedAppState(profile, {
      availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
      autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
      activeStreamer: null, tabId: null,
    });
    const popup = await openPopup(profile);
    await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
    await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } });
    await expect.poll(async () => (await readAppState(popup)).queueAcquisitionRound?.nextRoundAt, { timeout: 60_000 }).toBeGreaterThan(Date.now());
    expect((await readAppState(popup)).activeStreamer).toBeNull();
    const page = profile.context.pages().find((candidate) => candidate.url().endsWith('/local_stream_one'));
    if (!page) throw new Error('Missing failed retained player');
    await page.locator('video').click();
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    await popup.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.drophunterKeepalive)).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('data-a-player-state', 'paused');
    expect((await readAppState(popup)).isRunning).toBe(false);
    expect(profile.context.pages().filter((candidate) => /\/local_stream_(one|two)$/.test(candidate.url()))).toEqual([page]);
  } finally { await profile.close(); }
});

test('Stop during Twitch control observation prevents a late retry in the same owned tab', async () => {
  test.setTimeout(60_000);
  const profile = await createExtensionProfile();
  try {
    const twitch = await installLocalTwitchFixture(profile);
    twitch.supportTwitchPlayControl('local_stream_one');
    await seedAppState(profile, {
      availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
      autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
      activeStreamer: null, tabId: null,
    });
    const popup = await openPopup(profile);
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    const worker = await getExtensionWorker(profile.context);
    await worker.evaluate(() => {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      Object.defineProperty(chrome.tabs, 'sendMessage', { value: async (tabId: number, message: { type?: string }, options?: chrome.tabs.MessageSendOptions) => {
        if (message.type !== 'PREPARE_STREAM_PLAYBACK') return send(tabId, message, options ?? {});
        await chrome.scripting.executeScript({ target: { tabId }, func: () => {
          const video = document.querySelector<HTMLVideoElement>('video');
          if (!video) throw new Error('Missing local control player');
          Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 0 });
          const play = video.play.bind(video);
          video.play = () => {
            video.dataset.fixtureNativeRetries = String(Number(video.dataset.fixtureNativeRetries ?? 0) + 1);
            return play();
          };
        } });
        const result = await send(tabId, message, options ?? {});
        await chrome.scripting.executeScript({ target: { tabId }, func: () => {
          const video = document.querySelector<HTMLVideoElement>('video');
          if (video) video.dataset.fixturePreparationSettled = 'yes';
        } });
        return result;
      } });
    });
    await popup.getByRole('button', { name: /^Start Queue/ }).click();
    await expect.poll(() => profile.context.pages().some((page) => page.url().endsWith('/local_stream_one'))).toBe(true);
    const page = profile.context.pages().find((candidate) => candidate.url().endsWith('/local_stream_one'));
    if (!page) throw new Error('Missing owned control player');
    await expect(page.locator('video')).toHaveAttribute('data-fixture-explicit-play-clicks', '1');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveAttribute('data-a-player-state', 'playing');
    const tab = await popup.evaluate(() => chrome.tabs.query({ url: 'https://www.twitch.tv/local_stream_one' }));
    expect(tab).toHaveLength(1);
    await popup.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('video')).toHaveAttribute('data-fixture-preparation-settled', 'yes');
    expect(await page.locator('video').getAttribute('data-fixture-native-retries')).toBeNull();
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.drophunterKeepalive)).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('data-a-player-state', 'paused');
    expect((await readAppState(popup)).isRunning).toBe(false);
    expect(await popup.evaluate(() => chrome.tabs.query({ url: 'https://www.twitch.tv/local_stream_one' }))).toMatchObject([{ id: tab[0]?.id }]);
  } finally { await profile.close(); }
});

test('Stop cancels initial Start Queue before the first player is ready', async () => {
  test.setTimeout(60_000);
  const profile = await createExtensionProfile();
  try {
    const twitch = await installLocalTwitchFixture(profile);
    await seedAppState(profile, {
      availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
      autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
      activeStreamer: null, tabId: null,
    });
    const popup = await openPopup(profile);
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    const held = twitch.holdPlaybackResponse('local_stream_one');
    await popup.getByRole('button', { name: /^Start Queue/ }).click();
    await held.requested;
    try {
      await popup.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect.poll(async () => (await readAppState(popup)).manualQueueAuthorized).toBe(false);
    } finally {
      held.release();
    }
    await expect(popup.getByRole('button', { name: /^Start Queue/ })).toBeEnabled({ timeout: 30_000 });
    expect((await readAppState(popup)).isRunning).toBe(false);
    expect((await readAppState(popup)).activeStreamer).toBeNull();
  } finally {
    await profile.close();
  }
});

for (const control of ['Pause', 'Stop'] as const) {
  test(`${control} interrupts queue Play while the replacement page is still loading`, async () => {
    test.setTimeout(90_000);
    const profile = await createExtensionProfile();
    try {
      const twitch = await installLocalTwitchFixture(profile);
      await seedAppState(profile, {
        availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
        autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
        activeStreamer: null, tabId: null,
      });
      const popup = await openPopup(profile);
      await runtimeMessage(popup, { type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
      await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
      await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
      for (const game of games) await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game } });
      expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
      await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');
      const held = twitch.holdPlaybackResponse('local_stream_two');
      await popup.getByRole('button', { name: /^Start Local Game Two.* now$/ }).click();
      await held.requested;
      try {
        await popup.getByRole('button', { name: control, exact: true }).click();
        await expect.poll(async () => {
          const state = await readAppState(popup);
          return control === 'Pause' ? state.isPaused : !state.isRunning;
        }).toBe(true);
      } finally {
        held.release();
      }
      const state = await readAppState(popup);
      expect(state.selectedGame?.campaignId).toBe(games[1]?.campaignId);
      expect(state.isPaused).toBe(control === 'Pause');
      expect(state.isRunning).toBe(control === 'Pause');
      expect(state.manualQueueAuthorized).toBe(control === 'Pause');
    } finally {
      await profile.close();
    }
  });
}

test('completes the first queued campaign and promotes a coherent managed watch for the next one', async () => {
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
    expect(typeof advanced.tabId).toBe('number');
    expect(advanced.activeStreamer?.name).toBe('local_stream_two');
    expect(twitch.observedOperations).toContain('DirectoryPage_Game:local-game-two');

    const promoted = await assertCurrentManagedPlayback(profile, popup, 'local_stream_two');
    expect(advanced.tabId).toBe(originalTabId);
    expect(removedTabIds).not.toContain(originalTabId);
    expect(promoted).toBe(managedPage);
    expect(profile.context.pages().filter((page) => /\/local_stream_(one|two)$/.test(page.url()))).toEqual([promoted]);
  } finally {
    await profile.close();
  }
});

test('browser restart resumes actual managed playback without a Drops label and progress without pressing Start', async () => {
  test.setTimeout(210_000);
  const original = await createExtensionProfile();
  let restarted: Awaited<ReturnType<typeof createExtensionProfile>> | undefined;
  try {
    const initialTwitch = await installLocalTwitchFixture(original);
    initialTwitch.hideDropsSignal('local_stream_one');
    await seedAppState(original, {
      availableGames: games, selectedGame: games[0], queue: [], isRunning: false, isPaused: false,
      autoStartFavoriteGames: false, monitorAutoOpen: false, watchTransportPreference: 'managed-tab',
      activeStreamer: null, tabId: null,
    });
    const popup = await openPopup(original);
    await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await runtimeMessage(popup, { type: 'UPDATE_GAMES', payload: games });
    await runtimeMessage(popup, { type: 'ADD_TO_QUEUE', payload: { game: games[0] } });
    expect(await runtimeMessage(popup, { type: 'START_FARMING', payload: { game: games[0] } })).toEqual({ success: true });
    await assertCurrentManagedPlayback(original, popup, 'local_stream_one');
    await original.shutdown();
    restarted = await createExtensionProfile(original.userDataDir);
    const twitch = await installLocalTwitchFixture(restarted);
    twitch.hideDropsSignal('local_stream_one');
    const reopened = await openPopup(restarted);
    await expect.poll(async () => {
      const state = await readAppState(reopened);
      return [state.isRunning, state.isPaused, state.activeStreamer?.name, typeof state.tabId];
    }, { timeout: 90_000 }).toEqual([true, false, 'local_stream_one', 'number']);
    await assertCurrentManagedPlayback(restarted, reopened, 'local_stream_one');
    twitch.setPhase('progressed');
    // Make the five-minute inventory interval due; the next real progress alarm
    // must fetch it without a popup refresh or Start request.
    const worker = await getExtensionWorker(restarted.context);
    await worker.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 6 * 60_000;
    });
    await expect.poll(async () => (await readAppState(reopened)).currentDrop?.currentMinutes, {
      timeout: 65_000,
    }).toBe(1);
  } finally {
    await restarted?.shutdown();
    await original.close();
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
    await expect.poll(async () => {
        const state = await readAppState(popup);
        return state.activeStreamer?.name === 'local_stream_one' ? 'local_stream_one' : JSON.stringify({
          selected: state.selectedGame, metadata: state.queueEntryMetadataByKey, recovery: state.recoveryReason,
          episodes: Reflect.get(state, 'campaignFailureEpisodesByKey'), tabs: profile.context.pages().map((page) => page.url()),
        });
      }, { timeout: 30_000 }).toBe('local_stream_one');
    await expect.poll(async () => typeof (await readAppState(popup)).tabId, { timeout: 30_000 }).toBe('number');
    const managedPage = profile.context.pages().find((page) => page.url().endsWith('/local_stream_one'));
    if (!managedPage) throw new Error('Missing managed video');
    await managedPage.locator('video').click();
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    expect(await runtimeMessage(popup, { type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'tabless' } })).toMatchObject({ success: true });
    await expect.poll(async () => {
      const state = await readAppState(popup);
      return state.tabId === null ? null : {
        tabId: state.tabId, selectedGame: state.selectedGame,
        watchHealth: state.watchHealth, watchTransportMode: state.watchTransportMode,
      };
    }).toBeNull();
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
    await expect.poll(() => managedPage.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);

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

test('stalled rounds suspend one retained tab, retry unresolved targets and recover actual closure', async () => {
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
    await expect.poll(async () => {
        const state = await readAppState(popup);
        return state.activeStreamer?.name === 'local_stream_one' ? 'local_stream_one' : JSON.stringify({
          selected: state.selectedGame, metadata: state.queueEntryMetadataByKey, recovery: state.recoveryReason,
          episodes: Reflect.get(state, 'campaignFailureEpisodesByKey'), tabs: profile.context.pages().map((page) => page.url()),
        });
      }, { timeout: 30_000 }).toBe('local_stream_one');
    await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');

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
    const originalTabId = (await readAppState(popup)).tabId;
    for (let round = 0; round < 2; round += 1) {
      for (let campaign = 0; campaign < games.length; campaign += 1) {
        const expectedCampaign = games[campaign]?.campaignId;
        await expect.poll(async () => (await readAppState(popup)).selectedGame?.campaignId, { timeout: 25_000 }).toBe(expectedCampaign);
        await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 25_000 })
          .toBe(campaign === 0 ? 'local_stream_one' : 'local_stream_two');
        expect((await readAppState(popup)).tabId).toBe(originalTabId);
        // The fixture offers one channel per campaign. A healthy video with no
        // reward progress must park it after the five-minute minimum, never repeat it.
        await advanceAndTick(6 * 60_000);
        await expect.poll(async () => (await readAppState(popup)).queueAcquisitionRound?.attemptedCampaignKeys, { timeout: 30_000 })
          .toContain(`campaign:${expectedCampaign}`);
        expect((await readAppState(popup)).queueEntryMetadataByKey[`campaign:${expectedCampaign}`]?.attemptedStreamerNames)
          .toEqual([campaign === 0 ? 'local_stream_one' : 'local_stream_two']);
      }
      await expect.poll(async () => (await readAppState(popup)).queueAcquisitionRound?.nextRoundAt).not.toBeNull();
      const waiting = await readAppState(popup);
      expect(waiting.isRunning).toBe(true);
      expect(waiting.manualQueueAuthorized).toBe(true);
      expect(waiting.activeStreamer).toBeNull();
      expect(waiting.queueAcquisitionRound?.attemptedCampaignKeys).toHaveLength(2);
      await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
      const dormant = profile.context.pages().find((page) => /\/local_stream_(one|two)$/.test(page.url()));
      if (!dormant) throw new Error('Missing retained waiting tab');
      await expect.poll(() => dormant.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
      if (round === 0) {
        expect(await runtimeMessage(popup, { type: 'RETRY_FARMING' })).toMatchObject({ success: true });
      } else {
        const deadline = waiting.queueAcquisitionRound?.nextRoundAt;
        if (deadline == null) throw new Error('Missing round deadline');
        await advanceAndTick(Math.max(0, deadline - (Date.now() + wallOffset) - 60_000));
        expect((await readAppState(popup)).queueAcquisitionRound?.nextRoundAt).toBe(deadline);
        await advanceAndTick(60_001);
      }
      await expect.poll(async () => (await readAppState(popup)).activeStreamer?.name, { timeout: 30_000 }).toBe('local_stream_one');
      expect((await readAppState(popup)).tabId).toBe(originalTabId);
      await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');
    }
    const closedTabId = (await readAppState(popup)).tabId;
    const managedPage = await assertCurrentManagedPlayback(profile, popup, 'local_stream_one');
    await managedPage.close();
    await advanceAndTick(61_000);
    await expect.poll(async () => (await readAppState(popup)).tabId, { timeout: 25_000 }).not.toBeNull();
    const replacement = (await readAppState(popup)).tabId;
    expect(replacement).not.toBe(closedTabId);
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
