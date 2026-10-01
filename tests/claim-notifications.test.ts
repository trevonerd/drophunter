import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { recordClaimedDrops, setClaimRecordedHandler } from '../src/background/claim-log.ts';
import { createClaimRecordedHandler } from '../src/background/claim-notifications.ts';
import { createNotificationController } from '../src/background/notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchDrop } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let mocks: ChromeMocks;

beforeEach(() => {
  mocks = setupChromeMocks();
});

afterEach(() => {
  setClaimRecordedHandler(null);
  mocks.teardown();
});

test('a claim recorded from Twitch inventory creates one desktop notification', async () => {
  const state = { appState: { ...createInitialState(), notificationsEnabled: true } };
  const notifications: chrome.notifications.NotificationOptions[] = [];
  const telegramCalls: string[][] = [];
  const controller = createNotificationController(state, {
    permissionsApi: { contains: async () => true },
    notificationsApi: {
      create: async (
        notificationIdOrOptions: string | chrome.notifications.NotificationOptions,
        options?: chrome.notifications.NotificationOptions,
      ) => {
        const notificationOptions =
          typeof notificationIdOrOptions === 'string' ? options : notificationIdOrOptions;
        if (!notificationOptions) throw new TypeError('Notification options are required');
        notifications.push(notificationOptions);
        return 'notification-id';
      },
    },
    saveState: async () => undefined,
  });
  setClaimRecordedHandler(
    createClaimRecordedHandler({
      notifyBrowser: controller.notify,
      notifyTelegram: async (entries) => {
        telegramCalls.push(entries.map((entry) => entry.dropId));
      },
    }),
  );
  const drop: TwitchDrop = {
    id: 'reward-1',
    claimId: 'claim-1',
    name: 'Test Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    progress: 100,
    currentMinutes: 60,
    claimed: true,
    claimable: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };

  await Promise.all([recordClaimedDrops(state, [drop, { ...drop }]), recordClaimedDrops(state, [drop])]);

  expect(state.appState.totalDropsClaimed).toBe(1);
  expect(notifications).toEqual([
    expect.objectContaining({ title: 'Drop completed', message: 'Claimed: Test Reward (Test Game)' }),
  ]);
  expect(telegramCalls).toEqual([['reward-1']]);
});

test('a failed desktop delivery does not block Telegram claim alerts', async () => {
  const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const deliveries: string[] = [];
    const handler = createClaimRecordedHandler({
      notifyBrowser: async () => {
        deliveries.push('desktop');
        throw new Error('notification unavailable');
      },
      notifyTelegram: async () => {
        deliveries.push('telegram');
      },
    });

    await handler([
      {
        id: 'reward-2::campaign-1',
        dropId: 'reward-2',
        dropName: 'Second Reward',
        gameId: 'game-1',
        gameName: 'Test Game',
        campaignLabel: 'Test Game',
        claimedAt: 1,
      },
    ]);

    expect(deliveries).toEqual(['desktop', 'telegram']);
    expect(warning.mock.calls).toEqual([['[DropHunter]', 'Claim notification delivery failed']]);
  } finally {
    warning.mockRestore();
  }
});
