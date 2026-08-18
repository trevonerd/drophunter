import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { stopFarmingSession } from '../../src/background/session-lifecycle.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue14Part01() {
  describe('stopFarmingSession', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('calls onStopMonitoring callback', async () => {
      const state = createMinimalState();
      let stopMonitoringCalled = false;
      await stopFarmingSession(state, {
        onStopMonitoring: () => {
          stopMonitoringCalled = true;
        },
      });
      expect(stopMonitoringCalled).toBe(true);
    });

    test('resets stream tracking state', async () => {
      const state = createMinimalState({
        invalidStreamChecks: 5,
        noProgressRotationAttempts: 3,
      });
      await stopFarmingSession(state, {});
      expect(state.invalidStreamChecks).toBe(0);
      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('clears drop claim state', async () => {
      const state = createMinimalState();
      state.dropClaimRetryAtById.set('drop-1', Date.now());
      state.dropClaimInFlight = true;
      await stopFarmingSession(state, {});
      expect(state.dropClaimRetryAtById.size).toBe(0);
      expect(state.dropClaimInFlight).toBe(false);
    });

    test('closes managed tab via callback', async () => {
      const state = createMinimalState();
      state.appState.tabId = 123;
      let closedTabId: number | null = null;
      await stopFarmingSession(state, {
        onCloseManagedTab: async (tabId) => {
          closedTabId = tabId;
        },
      });
      expect(closedTabId).toBe(123);
    });

    test('resets running and paused flags', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.isPaused = true;
      await stopFarmingSession(state, {});
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.isPaused).toBe(false);
    });

    test('clears activeStreamer and tabId', async () => {
      const state = createMinimalState();
      state.appState.activeStreamer = { id: 'streamer-1', name: 'test', displayName: 'Test', isLive: true };
      state.appState.tabId = 123;
      await stopFarmingSession(state, {});
      expect(state.appState.activeStreamer).toBeNull();
      expect(state.appState.tabId).toBeNull();
    });

    test('applies stop state when stopReason provided', async () => {
      const state = createMinimalState();
      let applyStopStateCalled = false;
      await stopFarmingSession(state, {
        stopReason: 'user-stop',
        stopMessage: 'User stopped farming',
        onApplyStopState: () => {
          applyStopStateCalled = true;
        },
      });
      expect(applyStopStateCalled).toBe(true);
    });

    test('sends notification when provided', async () => {
      const state = createMinimalState();
      let notificationTitle = '';
      let notificationMessage = '';
      await stopFarmingSession(state, {
        notification: { title: 'Test Title', message: 'Test Message' },
        onNotify: async (title, message) => {
          notificationTitle = title;
          notificationMessage = message;
        },
      });
      expect(notificationTitle).toBe('Test Title');
      expect(notificationMessage).toBe('Test Message');
    });

    test('calls onSaveState callback', async () => {
      const state = createMinimalState();
      let saveStateCalled = false;
      await stopFarmingSession(state, {
        onSaveState: async () => {
          saveStateCalled = true;
        },
      });
      expect(saveStateCalled).toBe(true);
    });

    test('calls onSaveTimingState callback', async () => {
      const state = createMinimalState();
      let saveTimingCalled = false;
      await stopFarmingSession(state, {
        onSaveTimingState: async () => {
          saveTimingCalled = true;
        },
      });
      expect(saveTimingCalled).toBe(true);
    });

    test('uses clearRotationMetadata when provided', async () => {
      const state = createMinimalState();
      let clearRotationCalled = false;
      await stopFarmingSession(state, {
        onClearRotationMetadata: (appState) => {
          clearRotationCalled = true;
          return appState;
        },
      });
      expect(clearRotationCalled).toBe(true);
    });
  });
}
