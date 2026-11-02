import { afterEach, beforeEach, expect, test } from 'bun:test';
import { TIMING_STATE_KEY } from '../src/background/constants.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { loadTimingState } from '../src/background/timing-state-persistence.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { exportBackup } from '../src/shared/backup.ts';
import { getRecoveryPresentation } from '../src/shared/recovery-presentation.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

test('saving publishes the operational API deadline and clears an obsolete UI deadline', async () => {
  const state = createServiceWorkerState();
  state.apiBackoffUntil = Date.now() + 60_000;
  await saveState(state);
  expect(state.appState.apiBackoffUntil).toBe(state.apiBackoffUntil);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({
    apiBackoffUntil: state.apiBackoffUntil,
  });
  state.apiBackoffUntil = 0;
  await saveState(state);
  expect(state.appState.apiBackoffUntil).toBeNull();
});

test('worker restoration projects normalized timing instead of trusting the cached UI deadline', async () => {
  const state = createServiceWorkerState();
  state.appState = normalizeStoredAppState({
    ...state.appState,
    isRunning: true,
    recoveryReason: 'twitch-network',
    apiBackoffUntil: Date.now() + 7 * 24 * 60 * 60_000,
  });
  const deadline = Date.now() + 60_000;
  await mocks.storage.local.set({ [TIMING_STATE_KEY]: { apiBackoffUntil: deadline } });
  await loadTimingState(state);
  expect(state.apiBackoffUntil).toBe(deadline);
  expect(state.appState.apiBackoffUntil).toBe(deadline);
  expect(getRecoveryPresentation(state.appState)?.action).toBe('wait');
  await mocks.storage.local.remove(TIMING_STATE_KEY);
  await loadTimingState(state);
  expect(state.apiBackoffUntil).toBe(0);
  expect(state.appState.apiBackoffUntil).toBeNull();
});

test('UI deadlines are normalized and excluded from portable backups', () => {
  for (const apiBackoffUntil of [-1, Number.POSITIVE_INFINITY, 'tomorrow', undefined]) {
    expect(normalizeStoredAppState({ apiBackoffUntil }).apiBackoffUntil).toBeNull();
  }
  const state = createServiceWorkerState();
  state.appState.apiBackoffUntil = Date.now() + 60_000;
  expect(JSON.stringify(exportBackup(state.appState, [], 'test'))).not.toContain('apiBackoffUntil');
});
