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

export interface ExtensionProfileOptions {
  /** Route gql/www/spade.twitch.tv to a local mock on this port instead of staying offline. */
  readonly twitchMockPort?: number;
  /** Browser locale; defaults to the host's. */
  readonly locale?: string;
}

export async function createExtensionProfile(
  userDataDir?: string,
  options: ExtensionProfileOptions = {},
): Promise<ExtensionProfile> {
  const ownsProfile = userDataDir === undefined;
  const profilePath = userDataDir ?? (await mkdtemp(join(tmpdir(), 'drophunter-playwright-')));
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium',
    headless: true,
    locale: options.locale,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-background-networking',
      options.twitchMockPort === undefined
        ? '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'
        : `--host-resolver-rules=MAP gql.twitch.tv 127.0.0.1:${options.twitchMockPort}, MAP www.twitch.tv 127.0.0.1:${options.twitchMockPort}, MAP spade.twitch.tv 127.0.0.1:${options.twitchMockPort}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
      ...(options.twitchMockPort === undefined ? [] : ['--ignore-certificate-errors']),
    ],
  });
  if (options.twitchMockPort === undefined) await context.setOffline(true);
  let isShutdown = false;

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  // Worker discovery precedes initialization and activation sync. Wait for both
  // before tests seed storage, otherwise startup can overwrite the fixture.
  const readyPage = await context.newPage();
  await readyPage.goto(`chrome-extension://${extensionId}/icons/icon.svg`);
  await readyPage.evaluate(() => chrome.runtime.sendMessage({ type: 'ACTIVATE_POPUP' }));
  await readyPage.close();
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
      appState: {
        ...currentState,
        twitchSessionDetected: true,
        campaignEvidenceUserId: '123456789',
        // Control tests use verified local campaigns, not an offline API retry.
        campaignSyncState: {
          status: 'idle',
          lastAttemptAt: Date.now(),
          lastSuccessAt: Date.now(),
          campaignCount: 1,
          retryAttemptCount: 0,
          lastErrorKind: null,
          nextRetryAt: null,
          attemptDeadlineAt: null,
        },
        ...statePatch,
      },
      twitchSession: {
        oauthToken: 'playwright-local-token-0000000000000000',
        userId: '123456789',
        deviceId: 'playwright-device-0001',
        uuid: 'playwrighte2e0001',
      },
      storageSchemaVersion: 4,
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
  verificationState: 'unassessed',
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
