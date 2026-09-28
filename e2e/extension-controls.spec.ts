import { expect, test } from '@playwright/test';
import {
  createExtensionProfile,
  openPopup,
  runningState,
  seedAppState,
  seedStaleHeartbeat,
} from './extension-fixture';

type PersistedControlState = {
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly lastStopReason: string | null;
  readonly autoResumeOnStartup: boolean;
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
      autoResumeOnStartup: state.autoResumeOnStartup === true,
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
    });
  } finally {
    await profile.shutdown().catch(() => undefined);
    await seedProfile.close();
  }
});

test('paused and manually stopped sessions stay stopped after an extension worker restart', async () => {
  for (const [label, patch] of [
    ['paused', { ...runningState(true), isPaused: true }],
    ['auto-resume-disabled', runningState(false)],
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
          .toEqual(
            label === 'paused'
              ? [true, true, null]
              : label === 'auto-resume-disabled'
                ? [true, true, null]
                : [false, false, 'user-stop'],
          );
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

test('stale active session auto-resumes on extension startup when enabled', async () => {
  const profile = await createExtensionProfile();
  const profilePath = profile.userDataDir;
  try {
    await seedAppState(profile, runningState(true));
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
          return [state.isRunning, state.isPaused, state.autoResumeOnStartup];
        })
        .toEqual([true, false, true]);
    } finally {
      await restarted.shutdown();
    }
  } catch (error) {
    throw new Error('auto-resume restart scenario failed', { cause: error });
  } finally {
    await profile.close();
  }
});
