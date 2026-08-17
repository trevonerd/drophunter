import { describe, expect, test } from 'bun:test';
import {
  createFarmingAutomationBrowser,
  type FarmingAutomationChromeHost,
} from '../src/background/farming-automation-browser.ts';
import type { WatchOwnershipV1 } from '../src/background/farming-automation-contracts.ts';
import type { ManualStreamContext } from '../src/background/manual-watch-detector.ts';
import type { FarmingTarget } from '../src/background/watch-transport.ts';
import type { PlaybackPrepResult } from '../src/types/index.ts';

const incumbent: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'incumbent-token',
  expectedChannel: 'channel-a',
};

const target: FarmingTarget = {
  gameId: 'game-b',
  campaignId: 'campaign-b',
  channelName: 'channel-b',
};

type HostFixtureOptions = {
  readonly tabUrl?: string;
  readonly windowTabCount?: number;
};

function createHost(
  operationLog: string[],
  fixtureOptions: HostFixtureOptions = {},
): FarmingAutomationChromeHost {
  const sessionValues = new Map<string, unknown>();
  const tabUrl = fixtureOptions.tabUrl ?? 'https://www.twitch.tv/channel-b';
  const windowTabCount = fixtureOptions.windowTabCount ?? 2;
  return {
    tabs: {
      create: async (properties) => {
        operationLog.push(`open:${properties.active}:${properties.muted}`);
        return { id: 22, windowId: 4, url: properties.url, active: properties.active };
      },
      get: async () => ({
        id: 22,
        windowId: 4,
        url: tabUrl,
        active: false,
      }),
      query: async (query) =>
        query.active
          ? [{ id: 31, windowId: 5, url: 'https://www.twitch.tv/manual-channel', active: true }]
          : Array.from({ length: windowTabCount }, (_, index) => ({
              id: 22 + index,
              windowId: 4,
              url: index === 0 ? tabUrl : 'about:blank',
              active: index !== 0,
            })),
      update: async (tabId, properties) => {
        operationLog.push(`update:${tabId}:${properties.url ?? ''}`);
      },
      remove: async (tabId) => {
        operationLog.push(`remove:${tabId}`);
      },
    },
    sessionStorage: {
      get: async (key) => ({ [key]: sessionValues.get(key) }),
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) sessionValues.set(key, value);
      },
      remove: async (key) => {
        sessionValues.delete(key);
      },
    },
    permissions: { hasNotifications: async () => true },
    notifications: {
      create: async (id) => {
        operationLog.push(`notification:${id}`);
        return 'notification-id';
      },
    },
    alarms: {
      clear: async (name) => {
        operationLog.push(`clear:${name}`);
        return true;
      },
      create: (name, info) => {
        operationLog.push(`alarm:${name}:${info.when ?? info.periodInMinutes}`);
      },
    },
    runtime: { getUrl: (path) => `chrome-extension://test/${path}` },
  };
}

type AdapterFixtureOptions = {
  readonly currentOwnership?: WatchOwnershipV1 | null;
  readonly getManualStreamContext?: (tabId: number) => Promise<ManualStreamContext | null>;
  readonly playbackPreparation?: PlaybackPrepResult;
};

function createAdapter(
  host: FarmingAutomationChromeHost,
  operations: string[],
  fixtureOptions: AdapterFixtureOptions = {},
) {
  return createFarmingAutomationBrowser({
    host,
    watch: {
      tablessEnabled: true,
      heartbeat: async () => ({ accepted: true }),
      waitForTabComplete: async (_tabId, timeoutMs) => {
        operations.push(`wait:${timeoutMs}`);
      },
      preparePlayback: async (_tabId, options) => {
        operations.push(`prep:${options.activateTab}:${options.unmuteTab}:${options.muteAfterPrep}`);
        return fixtureOptions.playbackPreparation ?? { isPlaybackReady: true };
      },
      probeManaged: async (_ownership, explicitTarget) => {
        operations.push(`probe:${explicitTarget.campaignId}`);
        return { accepted: true, isLive: true, sameChannel: true, sameGame: true };
      },
    },
    getManualStreamContext: fixtureOptions.getManualStreamContext ?? (async () => null),
    currentOwnership: fixtureOptions.currentOwnership ?? incumbent,
    createOwnershipToken: () => 'candidate-token',
  });
}

describe('farming automation browser', () => {
  test('keeps A active until forced-muted B is promoted', async () => {
    // Given: Chrome host operations and an incumbent managed farming tab.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations), operations);

    // When: B is fully prepared and probed, before and then after promotion.
    const preparation = await adapter.watch.prepare(target, 'managed-tab');

    // Then: preparation is inactive/muted, probes B once, and cannot disturb A.
    expect(operations).toEqual([
      'open:false:true',
      'wait:15000',
      'prep:false:false:true',
      'probe:campaign-b',
    ]);
    expect(adapter.watch.currentOwnership()).toEqual(incumbent);
    expect(preparation.kind).toBe('prepared');
    if (preparation.kind !== 'prepared') throw new Error('Expected a prepared managed watch');
    const promotion = preparation.watch.promote();
    expect(promotion.kind).toBe('promoted');
    expect(adapter.watch.currentOwnership()).toEqual(preparation.watch.ownership);
  });

  test('replaces only the farming automation deadline alarm', async () => {
    // Given: an adapter with recording Chrome alarm operations.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations), operations);

    // When: a one-shot deadline is replaced and the periodic alarm is reconciled.
    const deadlineResult = await adapter.replaceDeadlineAlarm(5_000);
    const periodicResult = await adapter.schedulePeriodicAlarm(2);

    // Then: only the deadline name is cleared before its replacement.
    expect({ deadlineResult, periodicResult, operations }).toEqual({
      deadlineResult: 'scheduled',
      periodicResult: 'scheduled',
      operations: [
        'clear:favoriteCampaignDeadline',
        'alarm:favoriteCampaignDeadline:5000',
        'alarm:favoriteCampaignCheck:2',
      ],
    });
  });

  test('rejects managed B when typed playback preparation is not ready', async () => {
    // Given: B loads, but the typed content-script preparation reports playback blocked.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations), operations, {
      playbackPreparation: { isPlaybackReady: false, userInteractionRequired: true },
    });

    // When: the managed candidate is prepared.
    const preparation = await adapter.watch.prepare(target, 'managed-tab');

    // Then: B is disposed without probing, and A remains the current ownership.
    expect(preparation).toEqual({ kind: 'failed', reason: 'candidate-unavailable' });
    expect(operations).toEqual(['open:false:true', 'wait:15000', 'prep:false:false:true', 'remove:22']);
    expect(adapter.watch.currentOwnership()).toEqual(incumbent);
  });

  test('delivers automation notifications through the browser adapter', async () => {
    // Given: notification permission is available on the Chrome host.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations), operations);

    // When: the automation requests one deterministic notification.
    const permission = await adapter.hasNotificationPermission();
    const delivery = await adapter.deliverNotification({
      id: 'preemption-campaign-b',
      title: 'Campaign changed',
      message: 'Campaign B is ready.',
      priority: 2,
    });

    // Then: permission and delivery are surfaced as typed outcomes.
    expect({ permission, delivery, operations }).toEqual({
      permission: true,
      delivery: { kind: 'delivered', notificationId: 'notification-id' },
      operations: ['notification:preemption-campaign-b'],
    });
  });

  test('observes active Twitch tabs with typed stream context', async () => {
    // Given: one active manual Twitch tab with an observed live stream context.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations), operations, {
      getManualStreamContext: async (tabId) => ({
        channelName: `manual-${tabId}`,
        isLive: true,
        isPlaybackReady: true,
      }),
    });

    // When: Farming automation observes manual browser viewing.
    const observation = await adapter.observeManualTabs();

    // Then: the adapter returns a deterministic typed observation.
    expect(observation).toEqual({
      kind: 'observed',
      tabs: [
        {
          tab: {
            id: 31,
            windowId: 5,
            url: 'https://www.twitch.tv/manual-channel',
            active: true,
          },
          context: { channelName: 'manual-31', isLive: true, isPlaybackReady: true },
        },
      ],
    });
  });

  test.each([
    {
      name: 'closes a proven owned tab when another window tab exists',
      host: { windowTabCount: 2 },
      expectedResult: { kind: 'released', method: 'closed' },
      expectedDestructive: ['remove:22'],
    },
    {
      name: 'neutralizes a proven sole owned tab',
      host: { windowTabCount: 1 },
      expectedResult: { kind: 'released', method: 'neutralized' },
      expectedDestructive: ['update:22:about:blank'],
    },
    {
      name: 'preserves A and abandons unproven cleanup',
      host: { tabUrl: 'https://www.twitch.tv/unrelated-channel' },
      expectedResult: { kind: 'abandoned-unproven' },
      expectedDestructive: [],
    },
  ])('$name', async ({ host, expectedResult, expectedDestructive }) => {
    // Given: a prepared B receipt and the current tab/window proof variant.
    const operations: string[] = [];
    const adapter = createAdapter(createHost(operations, host), operations);
    const preparation = await adapter.watch.prepare(target, 'managed-tab');
    expect(preparation.kind).toBe('prepared');
    if (preparation.kind !== 'prepared') throw new Error('Expected a prepared managed watch');

    // When: post-commit cleanup consumes the candidate ownership receipt.
    const result = await adapter.watch.release(preparation.watch.ownership);

    // Then: only fully proven ownership permits a destructive browser action.
    expect(result).toEqual(expectedResult);
    expect(operations.filter((operation) => /^(remove|update):/.test(operation))).toEqual(
      expectedDestructive,
    );
  });
});
