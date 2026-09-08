import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createFarmingAutomationTwitchAdapter } from '../src/background/farming-automation-twitch.ts';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
import { TwitchGqlTransport } from '../src/background/twitch-api/gql.ts';
import type { TwitchDrop, TwitchSession } from '../src/types/index.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

const session: TwitchSession = { oauthToken: 'test', userId: 'viewer', deviceId: 'test', uuid: 'test' };
const game = { ...campaign('favorite', '2030-09-10T00:00:00Z'), dropCount: 1 };
const drop: TwitchDrop = {
  id: 'reward',
  name: 'Reward',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  campaignId: game.campaignId,
  progress: 0,
  currentMinutes: 0,
  claimed: false,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
  requiredMinutes: 60,
  remainingMinutes: 60,
};
afterEach(() => {
  mock.restore();
});

test.each(['', '   '])('automation waits for an identified account (%j)', async (userId) => {
  let calls = 0;
  const twitch = createFarmingAutomationTwitchAdapter({
    loadSession: async () => ({ ...session, userId }),
    fetchCampaignSnapshot: async () => {
      calls++;
      return { games: [game], drops: [drop], updatedAt: 1 };
    },
    fetchDirectoryStreamers: async () => {
      calls++;
      return { streamers: [], languageFilterApplied: false };
    },
  });
  expect(await twitch.refresh()).toEqual({ kind: 'session-missing' });
  expect(await twitch.fetchDirectory(game)).toEqual({ kind: 'session-missing' });
  expect(calls).toBe(0);
});

test.each([
  null,
  undefined,
  {},
  { dropCampaignsInProgress: null },
])('invalid raw Twitch inventory (%j) cannot notify or auto-start a favorite from default zero progress', async (inventory) => {
  spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
    currentUser: { inventory },
  });
  const client = new TwitchApiClient(session);
  let directories = 0;
  let notifications = 0;
  const twitch = createFarmingAutomationTwitchAdapter({
    loadSession: async () => session,
    fetchCampaignSnapshot: async () => ({
      games: [game],
      drops: [drop],
      inventoryVerified: false,
      updatedAt: 1,
    }),
    fetchInventorySnapshot: (_session, baseDrops) => client.fetchInventorySnapshot([...baseDrops]),
    fetchDirectoryStreamers: async () => {
      directories++;
      return {
        streamers: [{ id: 'live', name: 'live', displayName: 'Live', isLive: true, viewerCount: 1 }],
        languageFilterApplied: false,
      };
    },
  });
  const subject = fixture('priority-list-only', {
    queue: [],
    twitch,
    automationNotify: {
      notify: async () => {
        notifications++;
      },
    },
  });
  const outcome = await subject.automation.request('campaign-refresh');
  expect({
    directories,
    notifications,
    queue: subject.state.appState.queue,
    running: subject.state.appState.isRunning,
    outcome: outcome.kind,
  }).toEqual({ directories: 0, notifications: 0, queue: [], running: false, outcome: 'failed' });
});

test('a verified empty inventory preserves genuinely unearned rewards', async () => {
  spyOn(TwitchGqlTransport.prototype, 'postAuthorized').mockResolvedValue({
    currentUser: { inventory: { dropCampaignsInProgress: [], gameEventDrops: [] } },
  });
  const snapshot = await new TwitchApiClient(session).fetchInventorySnapshot([drop]);
  expect(snapshot.inventoryVerified).toBe(true);
  expect(snapshot.drops).toEqual([drop]);
});
