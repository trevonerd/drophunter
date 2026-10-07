import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import { createFarmingSessionHandlers } from '../src/background/farming-session-handlers.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

for (const boundary of ['activity', 'preparation'] as const) {
  for (const action of ['stop', 'pause'] as const) {
    test(`${action} during resume ${boundary} cannot promote or restart monitoring`, async () => {
      const mocks = setupChromeMocks();
      try {
        const state = createServiceWorkerState();
        const game = createGame({ campaignId: 'resume-campaign' });
        const streamer = createStreamer();
        const drop = createDrop({ campaignId: game.campaignId, requiredMinutes: 60, remainingMinutes: 45 });
        Object.assign(state.appState, {
          isRunning: true,
          manualQueueAuthorized: true,
          farmingSessionOrigin: 'manual',
          selectedGame: game,
          availableGames: [game],
          queue: [game],
          activeStreamer: streamer,
          currentDrop: drop,
          allDrops: [drop],
          pendingDrops: [drop],
          watchTransportPreference: 'managed-tab',
        });
        state.cachedDropsSnapshot = [drop];
        state.hasCurrentGenerationCampaignValidation = true;
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let resuming = false;
        let disposals = 0;
        const coordinator = createWatchTransportCoordinator({
          state,
          heartbeat: async () => ({ accepted: true }),
          managedTab: {
            open: async (target) => {
              if (resuming && boundary === 'preparation') {
                entered.resolve();
                await release.promise;
              }
              return {
                owner: 'drophunter',
                tabId: resuming ? 18 : 17,
                ownership: {
                  kind: 'managed-tab',
                  tabId: resuming ? 18 : 17,
                  ownershipToken: resuming ? 'resumed' : 'original',
                  expectedChannel: target.channelName,
                },
                dispose: async () => {
                  disposals++;
                },
              };
            },
            probe: async () => ({ accepted: true }),
            close: async () => {},
          },
          persist: async () => {},
          broadcast: () => {},
        });
        await coordinator.start(streamer);
        const session = createFarmingSession(
          state,
          createFarmingSessionAdapters({
            watchTransport: coordinator,
            fetchDirectoryStreamersFromApi: async () =>
              Object.assign([streamer], { languageFilterApplied: true }),
            trackActivity: async (reason) => {
              if (reason === 'resume-farming' && boundary === 'activity') {
                entered.resolve();
                await release.promise;
              }
            },
          }),
        );
        await session.handlePauseFarming();
        resuming = true;
        const alarmsBefore = mocks.alarms._created.length;
        const resume = session.handleResumeFarming();
        await entered.promise;
        const interrupted = action === 'stop' ? session.handleStopFarming() : session.handlePauseFarming();
        if (action === 'stop') await interrupted;
        release.resolve();
        await Promise.all([resume, interrupted]);
        expect(mocks.alarms._created.length).toBe(alarmsBefore);
        expect(coordinator.currentTarget()).toBeNull();
        expect(state.appState.watchHealth?.isHealthy).not.toBe(true);
        expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
        expect(disposals).toBe(boundary === 'preparation' ? 1 : 0);
        if (action === 'stop') {
          expect(state.appState.isRunning).toBe(false);
          expect(state.appState.lastStopReason).toBe('user-stop');
          expect(state.appState.manualQueueAuthorized).toBe(false);
        } else {
          expect(state.appState.isPaused).toBe(true);
          expect(state.appState.manualQueueAuthorized).toBe(true);
        }
      } finally {
        mocks.teardown();
      }
    });
  }
}

test.each(['no-streamers', 'directory-unavailable', 'open-failed'] as const)(
  'failed resume preserves watch evidence and the existing recovery deadline: %s',
  async (reason) => {
    const state = createServiceWorkerState();
    const health = createWatchHealth('managed-tab', 'stopped', 'stopped', Date.now);
    const deadline = Date.now() + 120_000;
    Object.assign(state.appState, {
      isRunning: true,
      isPaused: true,
      selectedGame: createGame(),
      activeStreamer: null,
      tabId: 17,
      watchHealth: health,
      recoveryReason: reason,
      recoveryBackoffUntil: deadline,
      recoveryAttempts: 2,
    });
    state.recoveryBackoffUntil = deadline;
    let monitoring = 0;
    const context = createFarmingSessionContext(state, createFarmingSessionAdapters());
    context.transitionCampaign = async () => ({ kind: 'failed', reason, error: 'Candidate unavailable' });
    const handlers = createFarmingSessionHandlers(context, {
      onEnsureWorkspace: async () => {},
      onRefreshDropsData: async () => {},
      onAdvanceQueueIfCompleted: async () => true,
      onAcquireStreamer: async () => false,
      onStartMonitoring: () => {
        monitoring++;
      },
      onStopMonitoring: () => {},
    });
    expect(await handlers.handleResumeFarming()).toEqual({ success: true });
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.watchHealth).toEqual(health);
    expect(state.appState.tabId).toBe(17);
    expect(state.appState.recoveryReason).toBe(reason);
    expect(state.appState.recoveryBackoffUntil).toBe(deadline);
    expect(state.recoveryBackoffUntil).toBe(deadline);
    expect(monitoring).toBe(1);
  },
);
