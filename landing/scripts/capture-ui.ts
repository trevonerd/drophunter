// Captures real popup + monitor screenshots from the built extension and
// marketing stills (OG image, favicons). Run from the repository root:
//   bun landing/scripts/capture-ui.ts
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import {
  createExtensionProfile,
  getExtensionWorker,
  openPopup,
  seedAppState,
} from '../../e2e/extension-fixture';
import { type MockCampaign, mockArtUrl, startTwitchMock } from '../../scripts/twitch-mock';

const ROOT = resolve(import.meta.dir, '../..');
const PUBLIC = resolve(ROOT, 'landing/public');
const SHOTS = resolve(PUBLIC, 'images/screenshots');
const ICONS = resolve(PUBLIC, 'icons');

const campaign = (
  id: string,
  game: string,
  name: string,
  drops: [string, number, number][],
): MockCampaign => ({
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

const idle = {
  totalDropsClaimed: 128,
  totalChannelPointsClaimed: 342,
  isRunning: false,
  wasRunning: false,
  isPaused: false,
  manualQueueAuthorized: true,
  autoStartFavoriteGames: false,
};

const healthyWatch = {
  mode: 'tabless' as const,
  isHealthy: true,
  status: 'healthy' as const,
  reason: 'heartbeat' as const,
  consecutiveFailures: 0,
  consecutiveStalls: 0,
  progress: 90,
  shouldFallback: false,
  checkedAt: NOW,
};

const farmingStreamer = {
  id: 'streamer-marvelrivals-1',
  name: 'marvelrivals_1',
  displayName: 'marvelrivals_1',
  isLive: true,
  viewerCount: 47,
  broadcasterLanguage: 'en',
};

type Slide = {
  file: string;
  alt: string;
  state?: Record<string, unknown>;
  viewport?: { width: number; height: number };
  act?: (popup: Page) => Promise<void>;
};

const slides: Slide[] = [
  {
    file: 'popup-queue',
    alt: 'DropHunter popup with a four-campaign farming queue, Marvel Rivals selected',
    state: idle,
  },
  {
    file: 'popup-farming',
    alt: 'DropHunter popup while hidden farming is running, showing drop progress and ETA',
    state: {
      ...idle,
      isRunning: true,
      wasRunning: true,
      farmingSessionOrigin: 'manual',
      watchTransportPreference: 'tabless',
      watchTransportMode: 'tabless',
      watchHealth: healthyWatch,
      activeStreamer: farmingStreamer,
    },
  },
  {
    file: 'popup-campaigns',
    alt: 'DropHunter campaign list showing reward progress for Marvel Rivals Season Launch Drops',
    state: { ...idle, queue: [] },
    act: async (popup) => {
      await popup.getByText('Marvel Rivals', { exact: true }).first().click();
    },
  },
  {
    file: 'popup-settings',
    alt: 'DropHunter settings: farming scope, hidden watch source, and notification toggles',
    state: idle,
    act: async (popup) => {
      await popup.getByRole('button', { name: 'Open settings' }).click();
    },
  },
  {
    file: 'popup-log',
    alt: 'DropHunter local claim log grouped by campaign',
    state: idle,
    act: async (popup) => {
      await popup.getByRole('button', { name: 'Open settings' }).click();
      await popup.getByRole('button', { name: /claim log/i }).click();
    },
  },
];

async function toWebp(pngPath: string, webpPath: string, quality = 82) {
  const proc = Bun.spawn(
    ['ffmpeg', '-y', '-i', pngPath, '-quality', String(quality), webpPath],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg failed converting ${pngPath}`);
}

async function captureExtensionUi() {
  await mkdir(SHOTS, { recursive: true });
  const mock = await startTwitchMock(CAMPAIGNS);
  try {
    for (const slide of slides) {
      const options = { twitchMockPort: mock.port, locale: 'en-US' };
      const seed = await createExtensionProfile(undefined, options);
      let profile = seed;
      try {
        const first = await openPopup(seed);
        await seedAppState(seed, { campaignSyncState: NEVER_SYNCED });
        await first.reload();
        const worker = await getExtensionWorker(seed.context);
        const synced = await worker.evaluate(async () => {
          for (let i = 0; i < 100; i++) {
            const { appState } = await chrome.storage.local.get('appState');
            if (appState?.campaignSyncState?.status === 'idle' && appState.availableGames?.length)
              return appState;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error('campaign sync against the mock did not complete');
        });
        const rank = (g: { campaignId?: string }) => CAMPAIGNS.findIndex((c) => c.id === g.campaignId);
        const games = [...synced.availableGames].sort((a, b) => rank(a) - rank(b));
        const drops = Array.isArray(synced.allDrops) ? synced.allDrops : [];
        const selected = games[0];
        const currentDrop =
          drops.find((d: { campaignId?: string }) => d.campaignId === selected?.campaignId) ??
          drops[0] ??
          null;
        await worker.evaluate(async (claimLog) => chrome.storage.local.set({ claimLog }), CLAIMS);
        const scene = {
          selectedGame: selected,
          queue: games,
          favoriteGames: FAVORITES,
          allDrops: drops,
          pendingDrops: drops.filter((d: { claimed?: boolean }) => !d.claimed),
          currentDrop,
          campaignSyncState: {
            ...NEVER_SYNCED,
            lastSuccessAt: Date.now(),
            campaignCount: games.length,
          },
          ...slide.state,
        };
        for (let attempt = 1; ; attempt++) {
          await seedAppState(seed, scene);
          await new Promise((r) => setTimeout(r, 500));
          const stored = await worker.evaluate(
            async () => (await chrome.storage.local.get('appState')).appState,
          );
          if (
            stored?.queue?.length === scene.queue.length &&
            stored.autoStartFavoriteGames === scene.autoStartFavoriteGames
          )
            break;
          if (attempt === 5) throw new Error(`${slide.file}: seeded scene did not persist`);
        }
        await seed.shutdown();
        profile = await createExtensionProfile(seed.userDataDir, options);
        const popup = await openPopup(profile);
        await popup.setViewportSize(slide.viewport ?? { width: 400, height: 640 });
        await slide.act?.(popup);
        await popup.waitForTimeout(900);
        const pngPath = `${SHOTS}/${slide.file}.png`;
        await popup.screenshot({ type: 'png', path: pngPath });
        await toWebp(pngPath, `${SHOTS}/${slide.file}.webp`);
        console.log(`wrote ${slide.file}`);

        if (slide.file === 'popup-farming') {
          const monitor = await profile.context.newPage();
          await monitor.setViewportSize({ width: 360, height: 270 });
          await monitor.goto(`${profile.extensionUrl}/monitor.html`);
          await monitor.waitForTimeout(700);
          const monitorPng = `${SHOTS}/monitor.png`;
          await monitor.screenshot({ type: 'png', path: monitorPng });
          await toWebp(monitorPng, `${SHOTS}/monitor.webp`);
          console.log('wrote monitor');
          await monitor.close();
        }
      } finally {
        await profile.shutdown().catch(() => undefined);
        await seed.close();
      }
    }
  } finally {
    await mock.stop();
  }
}

const OG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  @font-face {
    font-family: Inter;
    font-style: normal;
    font-weight: 100 900;
    src: url("https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2") format("woff2-variations");
  }
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    color: #f6f3ff;
    background:
      radial-gradient(ellipse 70% 80% at 78% 42%, rgba(145,70,255,.38), transparent 58%),
      radial-gradient(ellipse 50% 60% at 12% 88%, rgba(119,44,232,.22), transparent 50%),
      linear-gradient(145deg, #0b0b12 0%, #14101f 55%, #0e0e14 100%);
    display: flex;
    align-items: center;
    padding: 0 64px;
    gap: 40px;
    overflow: hidden;
  }
  .mark { width: 168px; height: 168px; filter: drop-shadow(0 0 36px rgba(145,70,255,.55)); flex: none; }
  .copy { min-width: 0; flex: 1; }
  .brand {
    font-size: 18px; font-weight: 650; letter-spacing: .18em; text-transform: uppercase;
    color: #c4a6ff; margin: 0 0 12px;
  }
  h1 {
    font-size: 52px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.05;
    margin: 0 0 16px; max-width: 860px;
  }
  p { margin: 0; font-size: 22px; line-height: 1.4; color: rgba(246,243,255,.72); max-width: 820px; }
  .by { margin-top: 20px; font-size: 15px; color: rgba(246,243,255,.45); letter-spacing: .04em; }
</style>
</head>
<body>
  <img class="mark" alt="" src="ICON_DATA"/>
  <div class="copy">
    <p class="brand">DropHunter</p>
    <h1>Auto-claim Twitch Drops while you’re away.</h1>
    <p>The Twitch Drops farmer extension by Trevisoft. Queue campaigns. Watch, switch, claim — locally, in Chrome.</p>
    <p class="by">getdrophunter.com · Not affiliated with Twitch or Amazon</p>
  </div>
</body>
</html>`;

async function captureOgAndIcons() {
  await mkdir(ICONS, { recursive: true });
  const iconSvg = await Bun.file(resolve(ROOT, 'public/icons/icon.svg')).text();
  const iconData = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;

  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await og.setContent(OG_HTML.replace('ICON_DATA', iconData), { waitUntil: 'networkidle' });
    const ogPng = resolve(PUBLIC, 'images/og.png');
    await mkdir(resolve(PUBLIC, 'images'), { recursive: true });
    await og.screenshot({ type: 'png', path: ogPng });
    await toWebp(ogPng, resolve(PUBLIC, 'images/og.webp'), 84);
    console.log('wrote og.png');
    await og.close();

    const sizes = [
      { name: 'favicon-32.png', size: 32 },
      { name: 'favicon-48.png', size: 48 },
      { name: 'apple-touch-icon.png', size: 180 },
      { name: 'icon-192.png', size: 192 },
      { name: 'icon-512.png', size: 512 },
    ];
    for (const { name, size } of sizes) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">
          <img src="${iconData}" width="${size}" height="${size}" style="display:block"/>
        </body></html>`,
      );
      await page.screenshot({
        type: 'png',
        path: resolve(ICONS, name),
        omitBackground: true,
      });
      await page.close();
      console.log(`wrote icons/${name}`);
    }
  } finally {
    await browser.close();
  }

  await Bun.write(resolve(PUBLIC, 'favicon.svg'), iconSvg);
  await Bun.write(resolve(ICONS, 'icon.svg'), iconSvg);
}

await mkdir(PUBLIC, { recursive: true });
await captureExtensionUi();
await captureOgAndIcons();
console.log('landing UI capture complete');
