// Regenerates store screenshots from the real built extension (.output/chrome-mv3),
// with campaign data served by a local Twitch mock. Run via `bun run screenshots`;
// output lands in .output/store-screenshots/ (1280x800 PNG).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createExtensionProfile, getExtensionWorker, openPopup, seedAppState } from '../e2e/extension-fixture';
import { type MockCampaign, mockArtUrl, startTwitchMock } from './twitch-mock';

const OUT = resolve(process.cwd(), '.output/store-screenshots');

const campaign = (id: string, game: string, name: string, drops: [string, number, number][]): MockCampaign => ({
  id: `${id}-campaign`,
  gameId: id,
  game,
  name,
  drops: drops.map(([dropName, requiredMinutes, currentMinutes], i) => ({
    id: `${id}-drop-${i}`,
    name: dropName,
    requiredMinutes,
    currentMinutes,
  })),
});
const CAMPAIGNS = [
  campaign('marvel-rivals', 'Marvel Rivals', 'Season Launch Drops', [
    ['Neon Strike Skin', 120, 108],
    ['Champion Emote', 240, 108],
  ]),
  campaign('poe2', 'Path of Exile 2', 'Early Access Rewards', [['Exile Banner', 180, 72]]),
  campaign('valorant', 'VALORANT', 'Champions Watch Party', [['Champion Card', 90, 36]]),
  campaign('fragpunk', 'FragPunk', 'Shard Rush', [['Shard Pack', 60, 21]]),
];
const NOW = Date.now();
const FAVORITES = ['marvel-rivals', 'valorant'].map((gameId, i) => ({
  gameId,
  lastKnownName: gameId === 'valorant' ? 'VALORANT' : 'Marvel Rivals',
  addedAt: NOW - i * 1000,
}));
const CLAIMS = [
  ['Rival Player Card', 'Marvel Rivals', 'Season Launch Drops'],
  ['Hero Spray', 'Marvel Rivals', 'Season Launch Drops'],
  ['Exile Stash Tab', 'Path of Exile 2', 'Early Access Rewards'],
  ['Spectre Skin', 'VALORANT', 'Champions Watch Party'],
  ['Player Title', 'VALORANT', 'Champions Watch Party'],
  ['Shard Booster', 'FragPunk', 'Shard Rush'],
  ['Rift Banner', 'Path of Exile 2', 'Early Access Rewards'],
  ['Victory Emote', 'FragPunk', 'Shard Rush'],
].map(([dropName, gameName, campaignName], i) => ({
  id: `claim-${i}`,
  dropId: `claimed-${i}`,
  dropName,
  gameId: gameName.toLowerCase().replace(/\W+/g, '-'),
  gameName,
  campaignName,
  campaignLabel: `${gameName} · ${campaignName}`,
  imageUrl: mockArtUrl(dropName),
  claimedAt: NOW - (i + 1) * 3 * 3600_000,
}));

const NEVER_SYNCED = {
  status: 'idle',
  lastAttemptAt: null,
  lastSuccessAt: null,
  campaignCount: null,
  retryAttemptCount: 0,
  lastErrorKind: null,
  nextRetryAt: null,
  attemptDeadlineAt: null,
};

type Slide = {
  file: string;
  title: string;
  sub: string;
  state?: Record<string, unknown>;
  act?: (popup: Page) => Promise<void>;
};
const idle = { totalDropsClaimed: 128, totalChannelPointsClaimed: 342, isRunning: false, wasRunning: false, manualQueueAuthorized: true, autoStartFavoriteGames: false };
const slides: Slide[] = [
  {
    file: '1-queue',
    title: 'Line up every campaign.',
    sub: 'Queue drops from different games. DropHunter works through them in order.',
    state: idle,
  },
  {
    file: '2-farming',
    title: 'Start it. Walk away.',
    sub: 'Live progress, ETA, and the current streamer, always one glance away.',
    state: { ...idle, isRunning: true, wasRunning: true, farmingSessionOrigin: 'manual' },
  },
  {
    file: '3-campaigns',
    title: 'Every drop, tracked.',
    sub: 'See each reward and how far along it is before you commit.',
    state: { ...idle, queue: [] },
    act: async (popup) => {
      await popup.getByText('Marvel Rivals', { exact: true }).first().click();
    },
  },
  {
    file: '4-settings',
    title: 'Your farming, your rules.',
    sub: 'Choose which campaigns to farm, how DropHunter watches, and which alerts you get.',
    state: idle,
    act: async (popup) => {
      await popup.getByRole('button', { name: 'Open settings' }).click();
    },
  },
  {
    file: '5-log',
    title: 'Every claim, logged.',
    sub: 'A local history of every reward you have earned. Never leaves your browser.',
    state: idle,
    act: async (popup) => {
      await popup.getByRole('button', { name: 'Open settings' }).click();
      await popup.getByRole('button', { name: /claim log/i }).click();
    },
  },
];

async function frame(shot: Buffer, title: string, sub: string): Promise<Buffer> {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(`<body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:90px;
    background:radial-gradient(circle at 75% 40%,#2a1458,#0e0e10 65%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff">
    <div style="max-width:480px"><h1 style="font-size:60px;line-height:1.05;margin:0 0 20px;letter-spacing:-2px">${title}</h1>
    <p style="font-size:24px;line-height:1.35;margin:0;color:rgba(255,255,255,.72)">${sub}</p></div>
    <img src="data:image/png;base64,${shot.toString('base64')}" style="height:640px;border-radius:16px;box-shadow:0 0 60px rgba(145,70,255,.45)"></body>`);
  const out = await page.screenshot({ type: 'png' });
  await browser.close();
  return out;
}

await mkdir(OUT, { recursive: true });
const mock = await startTwitchMock(CAMPAIGNS);
try {
  for (const slide of slides) {
    const options = { twitchMockPort: mock.port, locale: 'en-US' };
    const seed = await createExtensionProfile(undefined, options);
    let profile = seed;
    try {
      const first = await openPopup(seed);
      // Seed a Twitch session with no prior sync, so the reload triggers a real sync against the mock.
      await seedAppState(seed, { campaignSyncState: NEVER_SYNCED });
      await first.reload();
      const worker = await getExtensionWorker(seed.context);
      const synced = await worker.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
          const { appState } = await chrome.storage.local.get('appState');
          if (appState?.campaignSyncState?.status === 'idle' && appState.availableGames?.length)
            return appState.availableGames;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error('campaign sync against the mock did not complete');
      });
      // Queue in showcase order, not Twitch's expiry order.
      const rank = (g: { campaignId?: string }) => CAMPAIGNS.findIndex((c) => c.id === g.campaignId);
      const games = [...synced].sort((a, b) => rank(a) - rank(b));
      // The worker keeps state in memory: layer runtime state on top, then restart on the same profile.
      await worker.evaluate(async (claimLog) => chrome.storage.local.set({ claimLog }), CLAIMS);
      await worker.evaluate(async (claimLog) => chrome.storage.local.set({ claimLog }), CLAIMS);
      await seedAppState(seed, {
        selectedGame: games[0],
        queue: games,
        favoriteGames: FAVORITES,
        campaignSyncState: { ...NEVER_SYNCED, lastSuccessAt: Date.now(), campaignCount: games.length },
        ...slide.state,
      });
      await seed.shutdown();
      profile = await createExtensionProfile(seed.userDataDir, options);
      const popup = await openPopup(profile);
      await popup.setViewportSize({ width: 400, height: 640 });
      await slide.act?.(popup);
      await popup.waitForTimeout(1000);
      const png = await frame(await popup.screenshot({ type: 'png' }), slide.title, slide.sub);
      await Bun.write(`${OUT}/${slide.file}.png`, png);
      console.log(`wrote ${slide.file}.png`);
    } finally {
      await profile.shutdown().catch(() => undefined);
      await seed.close();
    }
  }
} finally {
  await mock.stop();
}
