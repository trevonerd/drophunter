import { expect, test } from '@playwright/test';
import packageJson from '../package.json' with { type: 'json' };
import { resolveReleaseVersion } from '../src/shared/release-version';
import {
  createExtensionProfile,
  fixtureDrop,
  getExtensionWorker,
  openPopup,
  runningState,
  seedAppState,
  seedStaleHeartbeat,
} from './extension-fixture';

type PersistedControlState = {
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly lastStopReason: string | null;
  readonly resumedFromCrash: number | null;
};

async function readControlState(page: Awaited<ReturnType<typeof openPopup>>): Promise<PersistedControlState> {
  return page.evaluate(async () => {
    const { appState } = await chrome.storage.local.get('appState');
    if (!appState || typeof appState !== 'object') throw new Error('Missing persisted app state');
    const state = appState as Record<string, unknown>;
    return {
      isRunning: state.isRunning === true,
      isPaused: state.isPaused === true,
      lastStopReason: typeof state.lastStopReason === 'string' ? state.lastStopReason : null,
      resumedFromCrash: typeof state.resumedFromCrash === 'number' ? state.resumedFromCrash : null,
    };
  });
}

test('popup runtime reports malformed control requests as useful errors', async () => {
  const profile = await createExtensionProfile();
  try {
    const popup = await openPopup(profile);
    const response = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'START_FARMING', payload: {} }),
    );
    expect(response).toEqual({ success: false, error: 'No game selected.' });
  } finally {
    await profile.close();
  }
});

test('popup pause, resume, and stop controls persist session transitions', async () => {
  const seedProfile = await createExtensionProfile();
  let profile = seedProfile;
  try {
    await test.step('seed and restart extension', async () => {
      // An active session resumes after a real browser restart, including old profiles.
      await seedAppState(seedProfile, runningState(false));
      await seedProfile.shutdown();
      profile = await createExtensionProfile(seedProfile.userDataDir);
    });
    const popup = await test.step('open running popup', () => openPopup(profile));
    await test.step('pause session', async () => {
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

      await popup.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const state = await readControlState(popup);
          return [state.isRunning, state.isPaused];
        })
        .toEqual([true, true]);
      await expect.poll(() => popup.evaluate(() => chrome.action.getBadgeText({}))).toBe('⏸');
      await expect.poll(() => popup.evaluate(() => chrome.action.getBadgeBackgroundColor({}))).toEqual([
        180, 83, 9, 255,
      ]);
    });

    await test.step('resume session', async () => {
      await expect(popup.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
      await popup.getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const state = await readControlState(popup);
          return [state.isRunning, state.isPaused];
        })
        .toEqual([true, false]);
      await expect.poll(() => popup.evaluate(() => chrome.action.getBadgeText({}))).toBe('10%');
    });

    await test.step('stop session', async () => {
      await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
      await popup.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Start Queue (1)', exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const state = await readControlState(popup);
          return [state.isRunning, state.isPaused, state.lastStopReason];
        })
        .toEqual([false, false, 'user-stop']);
      await expect.poll(() => popup.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
    });
  } finally {
    await profile.shutdown().catch(() => undefined);
    await seedProfile.close();
  }
});

test('paused and manually stopped sessions stay stopped after an extension worker restart', async () => {
  for (const [label, patch] of [
    ['paused', { ...runningState(true), isPaused: true }],
    ['stopped', { ...runningState(true), isRunning: false, wasRunning: false, lastStopReason: 'user-stop' }],
  ] as const) {
    const profile = await createExtensionProfile();
    try {
      await seedAppState(profile, patch);
      await seedStaleHeartbeat(profile);
      await profile.shutdown();

      const restarted = await createExtensionProfile(profile.userDataDir);
      try {
        const page = await openPopup(restarted);
        await expect
          .poll(async () => {
            const state = await readControlState(page);
            return [state.isRunning, state.isPaused, state.lastStopReason];
          })
          .toEqual(label === 'paused' ? [true, true, null] : [false, false, 'user-stop']);
        if (label === 'paused') {
          await expect.poll(() => page.evaluate(() => chrome.action.getBadgeText({}))).toBe('⏸');
        }
      } finally {
        await restarted.shutdown();
      }
    } catch (error) {
      throw new Error(`${label} restart scenario failed`, { cause: error });
    } finally {
      await profile.close();
    }
  }
});

test('stale active session resumes on extension startup with the retired setting disabled', async () => {
  const profile = await createExtensionProfile();
  const profilePath = profile.userDataDir;
  try {
    await seedAppState(profile, runningState(false));
    await seedStaleHeartbeat(profile);
    await profile.shutdown();

    const restarted = await createExtensionProfile(profilePath);
    try {
      const page = await openPopup(restarted);
      await expect
        .poll(async () => (await readControlState(page)).resumedFromCrash)
        .toBeGreaterThan(0);
      await expect
        .poll(async () => {
          const state = await readControlState(page);
          return [state.isRunning, state.isPaused];
        })
        .toEqual([true, false]);
      expect(await page.evaluate(async () => {
        const { appState } = await chrome.storage.local.get('appState');
        return 'autoResumeOnStartup' in (appState as Record<string, unknown>);
      })).toBe(false);
    } finally {
      await restarted.shutdown();
    }
  } catch (error) {
    throw new Error('auto-resume restart scenario failed', { cause: error });
  } finally {
    await profile.close();
  }
});

test('a Chrome MV3 worker recycle after progress does not pause active farming', async () => {
  const seedProfile = await createExtensionProfile();
  let profile = seedProfile;
  try {
    const progressingDrop = { ...fixtureDrop, progress: 1, currentMinutes: 1, remainingMinutes: 59 };
    await seedAppState(seedProfile, {
      ...runningState(false),
      currentDrop: progressingDrop,
      pendingDrops: [progressingDrop],
      allDrops: [progressingDrop],
    });
    await seedProfile.shutdown();
    profile = await createExtensionProfile(seedProfile.userDataDir);
    const popup = await openPopup(profile);
    await expect.poll(async () => (await readControlState(popup)).isPaused).toBe(false);
    await seedStaleHeartbeat(profile);

    const cdp = await profile.context.newCDPSession(popup);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    const ready = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CLAIM_LOG' }));
    expect(ready).toMatchObject({ success: true });
    expect(await readControlState(popup)).toMatchObject({
      isRunning: true,
      isPaused: false,
    });
    expect(await popup.evaluate(async () => {
      const { appState } = await chrome.storage.local.get('appState');
      return (appState as { currentDrop?: { progress?: number } }).currentDrop?.progress;
    })).toBe(1);
  } finally {
    await profile.shutdown().catch(() => undefined);
    await seedProfile.close();
  }
});

for (const isPaused of [false, true]) {
  test(`persistent profile upgrade from beta.46 preserves ${isPaused ? 'paused' : 'active'} queue intent`, async () => {
    const profile = await createExtensionProfile();
    try {
      const worker = await getExtensionWorker(profile.context);
      await expect.poll(async () => worker.evaluate(async () =>
        (await chrome.storage.local.get('storageSchemaVersion')).storageSchemaVersion,
      )).toBe(4);
      await seedAppState(profile, {
        ...runningState(false),
        isPaused,
        recoveryReason: 'open-failed',
        recoveryBackoffUntil: Date.now() + 365 * 24 * 60 * 60_000,
        recoveryAttempts: 99,
      });
      await worker.evaluate(() => chrome.storage.local.set({
        storageSchemaVersion: 4,
        lastInitializedExtensionVersion: '3.99.0.46',
      }));
      expect(await worker.evaluate(async () => {
        const data = await chrome.storage.local.get(['storageSchemaVersion', 'lastInitializedExtensionVersion', 'appState']);
        return [data.storageSchemaVersion, data.lastInitializedExtensionVersion, (data.appState as Record<string, unknown>).recoveryReason];
      })).toEqual([4, '3.99.0.46', 'open-failed']);
      await profile.shutdown();
      const upgraded = await createExtensionProfile(profile.userDataDir);
      try {
        const popup = await openPopup(upgraded);
        await expect.poll(async () => popup.evaluate(async () => {
          const { appState, storageSchemaVersion, lastInitializedExtensionVersion } = await chrome.storage.local.get(['appState', 'storageSchemaVersion', 'lastInitializedExtensionVersion']);
          const state = appState as Record<string, unknown>;
          return [storageSchemaVersion, lastInitializedExtensionVersion, state.recoveryReason, state.recoveryBackoffUntil, state.isPaused, state.isRunning, state.wasRunning,
            state.manualQueueAuthorized,
            (state.queue as Array<{ campaignId: string }>)[0]?.campaignId];
        })).toEqual([4, resolveReleaseVersion(packageJson.version).manifestVersion, null, null, isPaused, isPaused, !isPaused, true, 'e2e-campaign']);
      } finally {
        await upgraded.shutdown();
      }
    } finally {
      await profile.close();
    }
  });
}
