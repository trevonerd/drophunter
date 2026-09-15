import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyGlobalStreamerRecoveryState } from '../src/background/recovery-state.ts';
import {
  appendRuntimeDiagnosticEvent,
  flushRuntimeDiagnosticsForTests,
  type RuntimeDiagnosticEvent,
} from '../src/background/runtime-diagnostics.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { getRecoveryState, isStreamerAcquisitionRecovery } from '../src/shared/runtime-status.ts';
import { createAppState, createMinimalState } from './fixtures/state-persistence.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

const event: RuntimeDiagnosticEvent = {
  build: '4.0.0-beta.1',
  campaign: 'campaign:one',
  phase: 'recovering',
  failureKind: 'no-streamers',
  attempt: 1,
  deadline: 30_000,
  timestamp: 1_000,
};

describe('runtime diagnostic ring', () => {
  test('does not record every tick when only its timestamp changed', () => {
    // Given a persisted transition.
    const stored = [event];
    // When the same transition is observed on another tick.
    const events = appendRuntimeDiagnosticEvent(stored, { ...event, timestamp: 2_000 });
    // Then the original timestamp is retained without a duplicate.
    expect(events).toEqual([event]);
  });

  test('keeps only the latest 200 transitions when the local ring is full', () => {
    // Given two hundred different attempts in persisted history.
    const stored = Array.from({ length: 200 }, (_, attempt) => ({ ...event, attempt }));
    // When a new attempt is recorded.
    const events = appendRuntimeDiagnosticEvent(stored, { ...event, attempt: 200 });
    // Then the oldest event is evicted and the new attempt is retained.
    expect(events).toHaveLength(200);
    expect(events[0]?.attempt).toBe(1);
    expect(events[events.length - 1]?.attempt).toBe(200);
  });

  test('strips unexpected fields from both restored and incoming events', () => {
    // Given corrupt storage and an event carrying fields outside the allowlist.
    const stored = [null, { ...event, credential: 'stored-secret' }];
    const incoming = { ...event, attempt: 2, rawError: 'incoming-secret' };
    // When restoring and appending to the history.
    const events = appendRuntimeDiagnosticEvent(stored, incoming);
    // Then only normalized fields survive.
    expect(events).toEqual([event, { ...event, attempt: 2 }]);
  });
});

describe('runtime diagnostics persistence', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(async () => {
    await flushRuntimeDiagnosticsForTests();
    mocks.teardown();
  });

  test('records recovery metadata when saving a runtime transition without copying error text or credentials', async () => {
    // Given a recovery state containing sensitive text outside the diagnostic allowlist.
    const state = createMinimalState({
      appState: createAppState({
        isRunning: true,
        selectedGame: { id: 'game-1', campaignId: 'campaign-1', name: 'Private display text', imageUrl: '' },
        recoveryReason: 'twitch-network',
        recoveryAttempts: 2,
        recoveryBackoffUntil: 123_456,
        lastDropsPageRefreshError: 'Bearer secret-token',
      }),
    });

    // When the state reaches the persistence boundary.
    const startedAt = Date.now();
    await saveState(state);
    await flushRuntimeDiagnosticsForTests();

    // Then only safe transition fields reach the local ring.
    const events = mocks.storage.local._store.get('runtimeDiagnostics');
    const entry: unknown = Array.isArray(events) ? events[0] : undefined;
    if (!entry || typeof entry !== 'object' || !('timestamp' in entry)) {
      throw new TypeError('Missing diagnostic timestamp');
    }
    expect(entry.timestamp).toBeGreaterThanOrEqual(startedAt);
    expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
    expect(events).toEqual([
      {
        build: mocks.runtime.getManifest().version,
        campaign: 'campaign:campaign-1',
        phase: 'recovering',
        failureKind: 'twitch-network',
        attempt: 2,
        deadline: 123_456,
        timestamp: entry.timestamp,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-token');
    expect(JSON.stringify(events)).not.toContain('Private display text');
  });

  test('keeps farming persistence successful when writing diagnostics fails', async () => {
    // Given unavailable diagnostic storage while application storage still works.
    const originalSet = mocks.storage.local.set;
    mocks.storage.local.set = async (values) => {
      if ('runtimeDiagnostics' in values) throw new Error('private storage error');
      await originalSet(values);
    };
    const state = createMinimalState({ appState: createAppState({ isRunning: true }) });
    // When persisting the farming state.
    await saveState(state);
    await flushRuntimeDiagnosticsForTests();
    // Then the requested state is durable despite diagnostics failure.
    expect(mocks.storage.local._store.get('appState')).toMatchObject({ isRunning: true });
  });

  test('preserves transition order when state changes during concurrent saves', async () => {
    // Given independent captured recovery transitions.
    const states = [1, 2, 3].map((attempt) =>
      createMinimalState({
        appState: createAppState({
          isRunning: true,
          recoveryReason: 'twitch-network',
          recoveryAttempts: attempt,
        }),
      }),
    );
    // When all three persistence calls overlap.
    await Promise.all(states.map(saveState));
    await flushRuntimeDiagnosticsForTests();
    // Then no read-modify-write collision loses a transition.
    expect(mocks.storage.local._store.get('runtimeDiagnostics')).toMatchObject([
      { attempt: 1 },
      { attempt: 2 },
      { attempt: 3 },
    ]);
  });

  test('retains a global rate-limit deadline and campaign round through persistence and popup normalization', async () => {
    // Given a suspended acquisition round and a Twitch retry deadline longer than a campaign retry.
    const state = createMinimalState({ apiBackoffUntil: Date.now() + 600_000, apiConsecutiveFailures: 2 });
    state.appState.isRunning = true;
    state.appState.queueAcquisitionRound = {
      attemptedCampaignKeys: ['campaign:one', 'campaign:two'],
      nextRoundAt: null,
    };
    // When global recovery is saved and loaded through the shared popup/monitor boundary.
    applyGlobalStreamerRecoveryState(state, 'rate-limit');
    await saveState(state);
    await flushRuntimeDiagnosticsForTests();
    const restored = normalizeStoredAppState(mocks.storage.local._store.get('appState'));
    // Then the UI and diagnostic history retain the actual global deadline and unfinished round.
    expect(getRecoveryState(restored)).toEqual({
      reason: 'twitch-rate-limit',
      retryAt: state.apiBackoffUntil,
      attempts: 2,
    });
    expect(isStreamerAcquisitionRecovery(restored.recoveryReason)).toBe(true);
    expect(restored.queueAcquisitionRound).toEqual(state.appState.queueAcquisitionRound);
    expect(mocks.storage.local._store.get('runtimeDiagnostics')).toMatchObject([
      { phase: 'recovering', failureKind: 'twitch-rate-limit', deadline: state.apiBackoffUntil, attempt: 2 },
    ]);
  });
});
