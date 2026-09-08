import { describe, expect, test } from 'bun:test';
import {
  createAdapter,
  createHost,
  incumbent,
  target,
} from './support/farming-automation-browser-fixture.ts';

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

  test('observes background Twitch tabs with typed stream context', async () => {
    // Given: one inactive manual Twitch tab with an observed live stream context.
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

    // Then: the adapter returns a deterministic typed observation without filtering by focus.
    expect(observation).toEqual({
      kind: 'observed',
      tabs: [
        {
          tab: {
            id: 31,
            windowId: 5,
            url: 'https://www.twitch.tv/manual-channel',
            active: false,
          },
          context: { channelName: 'manual-31', isLive: true, isPlaybackReady: true },
        },
      ],
    });
  });

  test('excludes the owned managed tab before manual context probing', async () => {
    // Given: the current managed tab and a personal background channel are both open.
    const operations: string[] = [];
    const observedTabIds: number[] = [];
    const adapter = createAdapter(
      createHost(operations, {
        manualTabs: [
          { id: 11, windowId: 4, url: 'https://www.twitch.tv/channel-b', active: false },
          { id: 31, windowId: 5, url: 'https://www.twitch.tv/manual-channel', active: false },
        ],
      }),
      operations,
      {
        getManualStreamContext: async (tabId) => {
          observedTabIds.push(tabId);
          return { channelName: `manual-${tabId}`, isLive: true, isPlaybackReady: true };
        },
      },
    );

    // When: the automation observes user-controlled playback.
    await adapter.observeManualTabs();

    // Then: the extension never probes or protects its own managed tab as manual viewing.
    expect(observedTabIds).toEqual([31]);
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
