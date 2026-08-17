import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import type { FarmingAutomationPersistence } from '../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import type { FarmingAutomationTwitchSnapshot } from '../src/background/farming-automation-twitch.ts';
import { deriveSafeRefreshPatch } from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { createDeferred, flushMicrotasks } from './support/farming-automation-fixtures.ts';

function campaign(campaignId: string, endsAt: string): TwitchGame {
  return {
    id: 'shared-game',
    name: 'Shared Game',
    imageUrl: '',
    campaignId,
    campaignName: campaignId,
    endsAt,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function reward(game: TwitchGame): TwitchDrop {
  return {
    id: `drop-${game.campaignId}`,
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    campaignId: game.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

function startFixture(refreshGate: Promise<void> = Promise.resolve()) {
  const later = campaign('campaign-later', '2030-08-03T16:00:00.000Z');
  const best = campaign('campaign-best', '2030-08-03T12:00:00.000Z');
  const drops = [reward(later), reward(best)];
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [later, best],
    drops,
    campaignDropsByKey: { [gameKey(later)]: [drops[0]], [gameKey(best)]: [drops[1]] },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = 'ending-soonest';
  state.appState.favoriteGames = [{ gameId: 'shared-game', lastKnownName: 'Shared Game', addedAt: 1 }];
  const events: string[] = [];
  const basePersistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage: createInMemoryFarmingAutomationStorage(),
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => {
      events.push('broadcast');
    },
  });
  const persistence: FarmingAutomationPersistence = {
    ...basePersistence,
    commitTransition: async (commit) => {
      events.push('commit');
      return basePersistence.commitTransition(commit);
    },
    saveFacts: async (facts) => {
      events.push('facts');
      return basePersistence.saveFacts(facts);
    },
  };
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async (target) => ({
      target,
      ownership: {
        kind: 'managed-tab',
        tabId: 22,
        ownershipToken: 'owned-b',
        expectedChannel: target.channelName,
      },
      health: {
        mode: 'managed-tab',
        isHealthy: true,
        status: 'healthy',
        reason: 'heartbeat',
        consecutiveFailures: 0,
        consecutiveStalls: 0,
        progress: 0,
        shouldFallback: false,
        checkedAt: 1,
      },
      dispose: async () => {
        events.push('dispose');
      },
    }),
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'closed' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async (notification) => {
      events.push(`notification:${notification.id}`);
      return { kind: 'delivered', notificationId: notification.id };
    },
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => {
      events.push('alarm');
      return 'scheduled';
    },
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const streamer: TwitchStreamer = {
    id: 'streamer',
    name: 'channel',
    displayName: 'Channel',
    isLive: true,
    viewerCount: 1,
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch: {
      refresh: async () => {
        events.push('refresh');
        await refreshGate;
        return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
      },
      fetchDirectory: async (game) => ({
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: game.categoryId ?? null,
          categorySlug: game.name,
        },
        streamers: [streamer],
        languageFilterApplied: false,
      }),
    },
    now: () => 2_000,
    random: () => 0,
    onStarted: () => events.push('monitor'),
  });
  const refreshCount = () => events.filter((event) => event === 'refresh').length;
  return { automation, best, events, refreshCount, state };
}

describe('Farming automation start', () => {
  test('starts the highest-ranked eligible campaign through the public interface', async () => {
    // Given: two eligible campaigns sharing a game ID, with the earlier campaign ranked first.
    const fixture = startFixture();

    // When: the periodic public request evaluates the complete automation pipeline.
    // Then: the real Session transition commits the campaign-aware winner.
    const outcome = await fixture.automation.request('periodic');
    expect(outcome).toEqual({
      kind: 'started',
      campaignKey: gameKey(fixture.best),
      transition: 'start',
    });
    expect(gameKey(fixture.state.appState.selectedGame ?? fixture.best)).toBe(gameKey(fixture.best));
    expect(Object.keys(fixture.state.appState.campaignAvailabilityByKey)).toHaveLength(2);
    expect(fixture.events).toEqual([
      'refresh',
      'broadcast',
      'commit',
      'facts',
      'broadcast',
      'notification:farming-transition:start:idle:campaign:campaign-best:1000',
      'alarm',
      'monitor',
    ]);
  });

  test('refreshes disabled availability while preserving the other cheap gates', async () => {
    // Given: independent fixtures disabled, paused, or scoped to no favorite candidates.
    const disabled = startFixture();
    disabled.state.appState.autoStartFavoriteGames = false;
    disabled.state.appState.campaignPriorityMode = 'lowest-availability';
    const paused = startFixture();
    paused.state.appState.isPaused = true;
    const empty = startFixture();
    empty.state.appState.farmCategoryScope = 'favorites-only';
    empty.state.appState.favoriteGames = [];

    // When: each fixture receives the same public request.
    const outcomes = await Promise.all([
      disabled.automation.request('campaign-refresh'),
      paused.automation.request('periodic'),
      empty.automation.request('periodic'),
    ]);

    // Then: disabled catalog refresh projects availability while paused automation remains cheap.
    expect(outcomes).toEqual([
      { kind: 'unchanged', reason: 'disabled' },
      { kind: 'unchanged', reason: 'paused' },
      { kind: 'unchanged', reason: 'no-eligible-campaign' },
    ]);
    expect(disabled.refreshCount()).toBe(1);
    expect(Object.keys(disabled.state.appState.campaignAvailabilityByKey)).toHaveLength(2);
    expect(disabled.state.appState.queue).toEqual([]);
    expect(paused.refreshCount()).toBe(0);
    expect(empty.refreshCount()).toBe(1);
  });

  test('clears a durable browser-session snooze only on browser-start', async () => {
    // Given: a user snoozed the production automation instance.
    const subject = startFixture();
    const snooze = await subject.automation.snooze('manual-pause');

    // When: periodic evaluation precedes a browser-start evaluation.
    const periodic = await subject.automation.request('periodic');
    const browserStart = await subject.automation.request('browser-start');

    // Then: periodic stays snoozed while browser-start clears snooze and starts farming.
    expect({ snooze, periodic, browserStart }).toEqual({
      snooze: 'snoozed',
      periodic: { kind: 'unchanged', reason: 'snoozed' },
      browserStart: { kind: 'started', campaignKey: gameKey(subject.best), transition: 'start' },
    });
  });

  test('coalesces concurrent triggers into exactly one trailing evaluation', async () => {
    // Given: the first Twitch refresh is held while two more public triggers arrive.
    const gate = createDeferred<void>();
    const subject = startFixture(gate.promise);
    const first = subject.automation.request('periodic');
    await flushMicrotasks();

    // When: campaign-refresh and user-request join the same trailing run.
    const trailingCampaign = subject.automation.request('campaign-refresh');
    const trailingUser = subject.automation.request('user-request');
    gate.resolve(undefined);

    // Then: one active and one shared trailing evaluation produce two refreshes total.
    expect({
      first: await first,
      trailingCampaign: await trailingCampaign,
      trailingUser: await trailingUser,
      refreshCount: subject.refreshCount(),
    }).toEqual({
      first: { kind: 'started', campaignKey: gameKey(subject.best), transition: 'start' },
      trailingCampaign: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      trailingUser: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      refreshCount: 2,
    });
  });

  test('lets a newer state mutation supersede an evaluation during refresh', async () => {
    // Given: automation is refreshing from an enabled, unpaused fingerprint.
    const gate = createDeferred<void>();
    const subject = startFixture(gate.promise);
    const pending = subject.automation.request('periodic');
    await flushMicrotasks();

    // When: pause state changes before immutable refresh returns.
    subject.state.appState.isPaused = true;
    gate.resolve(undefined);

    // Then: the stale evaluation returns superseded without preparing or committing B.
    expect({ outcome: await pending, running: subject.state.appState.isRunning }).toEqual({
      outcome: { kind: 'unchanged', reason: 'superseded-by-state-change' },
      running: false,
    });
  });
});
