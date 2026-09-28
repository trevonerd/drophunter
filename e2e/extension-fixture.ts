import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, type Page, type Worker } from '@playwright/test';

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');

export interface ExtensionProfile {
  readonly userDataDir: string;
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly extensionUrl: string;
  shutdown(): Promise<void>;
  close(): Promise<void>;
}

export async function createExtensionProfile(userDataDir?: string): Promise<ExtensionProfile> {
  const ownsProfile = userDataDir === undefined;
  const profilePath = userDataDir ?? (await mkdtemp(join(tmpdir(), 'drophunter-playwright-')));
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  });
  await context.setOffline(true);
  let isShutdown = false;

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  const shutdown = async () => {
    if (isShutdown) return;
    isShutdown = true;
    await context.close();
  };

  return {
    userDataDir: profilePath,
    context,
    extensionId,
    extensionUrl: `chrome-extension://${extensionId}`,
    shutdown,
    async close() {
      await shutdown();
      if (ownsProfile) await rm(profilePath, { recursive: true, force: true });
    },
  };
}

export async function getExtensionWorker(context: BrowserContext): Promise<Worker> {
  const current = context.serviceWorkers().find((worker) => worker.url().endsWith('/background.js'));
  return (
    current ??
    context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().endsWith('/background.js'),
    })
  );
}

export async function openPopup(profile: ExtensionProfile): Promise<Page> {
  const worker = await getExtensionWorker(profile.context);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ onboardingCompleted: true });
  });
  const page = await profile.context.newPage();
  await page.goto(`${profile.extensionUrl}/popup.html`);
  return page;
}

export async function seedAppState(profile: ExtensionProfile, patch: Record<string, unknown>): Promise<void> {
  const worker = await getExtensionWorker(profile.context);
  await worker.evaluate(async (statePatch) => {
    const { appState = {} } = await chrome.storage.local.get('appState');
    const currentState = appState && typeof appState === 'object' ? appState : {};
    await chrome.storage.local.set({
      appState: { ...currentState, ...statePatch },
      twitchSession: {
        oauthToken: 'playwright-local-token-0000000000000000',
        userId: '123456789',
        deviceId: 'playwright-device-0001',
        uuid: 'playwrighte2e0001',
      },
      storageSchemaVersion: 3,
      lastInitializedExtensionVersion: chrome.runtime.getManifest().version,
      lastActivityAt: Date.now(),
      onboardingCompleted: true,
    });
  }, patch);
}

export async function seedStaleHeartbeat(profile: ExtensionProfile): Promise<void> {
  const worker = await getExtensionWorker(profile.context);
  await worker.evaluate(async () => {
    const { timingState = {} } = await chrome.storage.local.get('timingState');
    const currentTimingState = timingState && typeof timingState === 'object' ? timingState : {};
    await chrome.storage.local.set({
      timingState: { ...currentTimingState, lastHeartbeatAt: Date.now() - 60_000 },
    });
  });
}

export const fixtureGame = {
  id: 'e2e-game',
  name: 'Local Fixture Game',
  imageUrl: '',
  campaignId: 'e2e-campaign',
  campaignName: 'Local Fixture Campaign',
  isConnected: true,
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};

export const fixtureDrop = {
  id: 'e2e-drop',
  name: 'Local Fixture Reward',
  gameId: fixtureGame.id,
  gameName: fixtureGame.name,
  campaignId: fixtureGame.campaignId,
  imageUrl: '',
  progress: 10,
  currentMinutes: 6,
  requiredMinutes: 60,
  remainingMinutes: 54,
  claimed: false,
  claimable: false,
  status: 'pending',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'verified',
};

export function runningState(autoResumeOnStartup: boolean) {
  return {
    selectedGame: fixtureGame,
    availableGames: [fixtureGame],
    queue: [fixtureGame],
    currentDrop: fixtureDrop,
    pendingDrops: [fixtureDrop],
    allDrops: [fixtureDrop],
    isRunning: true,
    isPaused: false,
    wasRunning: true,
    autoResumeOnStartup,
    autoStartFavoriteGames: false,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    activeStreamer: null,
    tabId: null,
    lastStopReason: null,
    lastStopMessage: null,
  };
}
