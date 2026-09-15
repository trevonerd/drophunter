import { expect, spyOn, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { persistCampaignSyncState } from '../src/background/campaign-sync-state.ts';
import * as logging from '../src/background/logging.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createDeferred, flushMicrotasks } from './support/farming-automation-fixtures.ts';

test('publishes needs-session and clears retries even when notification delivery never settles', async () => {
  // Given: a running session needs browser verification and its notifier stalls.
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  const delivery = createDeferred<void>();
  let completed = false;
  let cleared = 0;
  const scheduled: number[] = [];
  const coordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: (next) =>
      persistCampaignSyncState(state, next, {
        save: async () => {},
        broadcast: () => {},
        notifyAutomation: () => delivery.promise,
      }),
    performSync: async () => ({ kind: 'needs-session' }),
    clearRetry: () => {
      cleared += 1;
    },
    scheduleRetry: (at) => {
      scheduled.push(at);
    },
  });
  // When: campaign validation reaches the action-required state.
  const request = coordinator.request('browser-start').then((result) => {
    completed = true;
    return result;
  });
  try {
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    // Then: publication and alarm reconciliation do not wait for the notifier.
    expect(completed).toBe(true);
    expect(state.appState.campaignSyncState.status).toBe('needs-session');
    expect(state.appState.campaignSyncState.nextRetryAt).toBeNull();
    expect(cleared).toBeGreaterThan(0);
    expect(scheduled).toEqual([]);
  } finally {
    delivery.resolve();
    await request;
  }
});

test('reports rejected notification delivery without failing publication or logging its payload', async () => {
  // Given: notification delivery rejects with potentially sensitive provider text.
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  const warning = spyOn(logging, 'logWarn').mockImplementation(() => {});
  let broadcasts = 0;
  try {
    // When: the user-action state is persisted and broadcast.
    await persistCampaignSyncState(
      state,
      {
        ...state.appState.campaignSyncState,
        status: 'needs-session',
        lastErrorKind: 'session',
      },
      {
        save: async () => {},
        broadcast: () => {
          broadcasts += 1;
        },
        notifyAutomation: async () => {
          throw new Error('sensitive-provider-payload');
        },
      },
    );
    await flushMicrotasks();
    // Then: the published state survives, with only a safe fixed warning.
    expect(broadcasts).toBe(1);
    expect(state.appState.campaignSyncState.status).toBe('needs-session');
    expect(warning).toHaveBeenCalledWith('Campaign session notification delivery failed');
  } finally {
    warning.mockRestore();
  }
});

test('suppresses delivery when Stop arrives after saving but before its notification microtask', async () => {
  // Given: a running session publishes the need for browser verification.
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  const notifications: string[] = [];
  // When: the user stops between publication and detached notification delivery.
  await persistCampaignSyncState(
    state,
    { ...state.appState.campaignSyncState, status: 'needs-session', lastErrorKind: 'session' },
    {
      save: async () => {},
      broadcast: () => {
        queueMicrotask(() => {
          state.appState.lastStopReason = 'user-stop';
        });
      },
      notifyAutomation: async (notification) => {
        notifications.push(notification.event);
      },
    },
  );
  await flushMicrotasks();
  // Then: the superseded warning is never sent.
  expect(notifications).toEqual([]);
});
