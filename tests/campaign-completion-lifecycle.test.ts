import { describe, expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createFarmingAutomationTwitchAdapter } from '../src/background/farming-automation-twitch.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../src/types/index.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

function completedCampaignFixture(options: { readonly onDirectory?: () => void } = {}) {
  const game: TwitchGame = { ...campaign('favorite', '2030-08-03T12:00:00.000Z'), dropCount: 1 };
  const drop: TwitchDrop = {
    id: 'reward',
    campaignId: game.campaignId,
    gameId: game.id,
    gameName: game.name,
    name: 'Reward',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
  const snapshot: DropsSnapshot = { games: [game], drops: [drop], updatedAt: 1_000 };
  const notifications: string[] = [];
  const twitch = createFarmingAutomationTwitchAdapter({
    loadSession: async () => ({
      oauthToken: 'fixture',
      userId: 'viewer',
      deviceId: 'fixture',
      uuid: 'fixture',
    }),
    fetchCampaignSnapshot: async () => snapshot,
    fetchInventorySnapshot: async () => ({ games: [], drops: [], updatedAt: 1_000 }),
    fetchDirectoryStreamers: async () => {
      options.onDirectory?.();
      return {
        streamers: [{ id: 'channel', name: 'channel', displayName: 'Channel', isLive: true }],
        languageFilterApplied: false,
      };
    },
  });
  const subject = fixture('priority-list-only', {
    queue: [],
    twitch,
    automationNotify: {
      notify: async (event) => {
        notifications.push(event.event);
      },
    },
  });
  const completed: TwitchGame = {
    ...game,
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  };
  subject.state.appState.availableGames = [completed];
  subject.state.cachedDropsSnapshot = [{ ...drop, progress: 100, claimed: true }];
  subject.state.appState.allDrops = [...subject.state.cachedDropsSnapshot];
  return { ...subject, game, completed, snapshot, notifications };
}

describe('Campaign completion through public farming automation', () => {
  test('retains an earned reward awaiting claim when fresh data omits claimability', async () => {
    // Given: watch time is fulfilled, but Twitch has not confirmed acquisition yet.
    const subject = completedCampaignFixture();
    subject.state.appState.availableGames = [subject.game];
    subject.state.cachedDropsSnapshot = subject.snapshot.drops.map((drop) => ({
      ...drop,
      progress: 100,
      claimable: true,
    }));
    subject.state.appState.allDrops = [...subject.state.cachedDropsSnapshot];

    // When: campaign data temporarily falls back to zero and omits claimability.
    await subject.automation.request('campaign-refresh');

    // Then: the normal claim flow remains available instead of recording false acquisition.
    expect(subject.state.appState.currentDrop?.claimable).toBe(true);
    expect(subject.state.appState.acquiredCampaignIds ?? []).toEqual([]);
  });

  test('remembers acquisition after the campaign disappears from the refreshed catalog', async () => {
    // Given: a completed campaign is replaced by another campaign in a later catalog.
    const subject = completedCampaignFixture();
    projectDropsSnapshot(
      subject.state,
      {
        games: [campaign('other', '2030-08-04T00:00:00.000Z')],
        drops: subject.snapshot.drops.map((drop) => ({
          ...drop,
          campaignId: 'campaign-other',
          gameId: 'other',
        })),
        updatedAt: 1_500,
      },
      'campaign-authoritative',
    );

    // When: Twitch subsequently lists the same completed ID again with regressed progress.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: absence from the catalog did not erase terminal acquisition evidence.
    expect(outcome).toEqual({ kind: 'unchanged', reason: 'no-eligible-campaign' });
    expect(subject.notifications).toEqual([]);
  });

  test('preserves completion when a normal refresh projects regressed drops before automation', async () => {
    // Given: the idle UI and persisted catalog have already observed every campaign reward acquired.
    const subject = completedCampaignFixture();

    // When: normal refresh projects weaker progress before requesting automatic selection.
    projectDropsSnapshot(subject.state, subject.snapshot, 'campaign-authoritative');
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: an intermediate UI projection cannot erase the evidence and resurrect the favorite.
    expect(outcome).toEqual({ kind: 'unchanged', reason: 'no-eligible-campaign' });
    expect(subject.notifications).toEqual([]);
    expect(subject.state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
  });

  test.each([
    false,
    true,
  ])('retains incoming positive completion with duplicate rows: %s', async (duplicate) => {
    // Given: the incoming snapshot contains completion evidence but its drop progress is stale.
    const subject = completedCampaignFixture();
    subject.snapshot.games = duplicate ? [subject.completed, subject.game] : [subject.completed];
    subject.state.appState.availableGames = [];
    subject.state.cachedDropsSnapshot = [];
    subject.state.appState.allDrops = [];

    // When: the real Twitch adapter normalizes this snapshot.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: normalization does not replace positive acquisition evidence with zero progress.
    expect(outcome).toEqual({ kind: 'unchanged', reason: 'no-eligible-campaign' });
    expect(subject.notifications).toEqual([]);
  });

  test('rejects a completion that arrives during directory discovery', async () => {
    // Given: a valid candidate whose inventory becomes acquired during the async directory lookup.
    const subject = completedCampaignFixture({
      onDirectory: () => {
        subject.state.appState.allDrops = subject.snapshot.drops.map((drop) => ({
          ...drop,
          claimed: true,
          progress: 100,
        }));
      },
    });
    subject.state.appState.availableGames = [subject.game];
    subject.state.cachedDropsSnapshot = [];
    subject.state.appState.allDrops = [];

    // When: discovery finishes with a stale candidate snapshot.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: it is superseded before queue or notifications can consume the old snapshot.
    expect(outcome).toEqual({ kind: 'unchanged', reason: 'superseded-by-state-change' });
    expect(subject.notifications).toEqual([]);
    expect(subject.state.appState.queue).toEqual([]);
  });

  test('does not activate a campaign that expires while its watch is prepared', async () => {
    // Given: an eligible favorite at discovery time, expiring during transport preparation.
    let now = Date.parse('2030-08-03T11:59:00.000Z');
    const subject = fixture('priority-list-only', {
      queue: [],
      now: () => now,
      onPrepare: () => {
        now = Date.parse('2030-08-03T12:01:00.000Z');
      },
    });

    // When: the candidate reaches its final activation boundary.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: the obsolete preparation never starts farming.
    expect(outcome.kind).not.toBe('started');
    expect(subject.state.appState.isRunning).toBe(false);
  });

  test('does not queue or start a favorite whose rewards have not started', async () => {
    // Given: new campaign rewards which begin after the evaluation time.
    const subject = completedCampaignFixture();
    subject.state.appState.availableGames = [];
    subject.state.cachedDropsSnapshot = [];
    subject.state.appState.allDrops = [];
    subject.snapshot.drops = subject.snapshot.drops.map((drop) => ({
      ...drop,
      startsAt: '2030-08-01T00:00:00.000Z',
    }));

    // When: automation discovers the favorite.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: future rewards do not generate queue or activation events.
    expect(outcome).toEqual({ kind: 'unchanged', reason: 'no-eligible-campaign' });
    expect(subject.state.appState.queue).toEqual([]);
    expect(subject.notifications).toEqual([]);
  });

  test('removes a completed campaign already persisted in the manual queue', async () => {
    // Given: a completed campaign left in a persisted manual queue.
    const subject = completedCampaignFixture();
    subject.state.appState.queue = [subject.game];
    subject.state.appState.queueEntryMetadataByKey = {
      [gameKey(subject.game)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
    };

    // When: the worker evaluates the restored queue against the campaign evidence.
    await subject.automation.request('worker-init');

    // Then: neither durable queue nor live queue retains the completed entry.
    expect(subject.state.appState.queue).toEqual([]);
    expect(subject.storage.getLocal('appState')).toMatchObject({ queue: [], queueEntryMetadataByKey: {} });
    expect(subject.notifications).toEqual([]);
  });

  test('allows a new campaign ID for the same favorite game', async () => {
    // Given: the completed game has a new campaign with an independent reward identity.
    const subject = completedCampaignFixture();
    const next = { ...subject.game, campaignId: 'new-campaign' };
    subject.snapshot.games = [next];
    subject.snapshot.drops = subject.snapshot.drops.map((drop) => ({ ...drop, campaignId: next.campaignId }));

    // When: the same favorite category is discovered again.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: only the new campaign starts.
    expect(outcome).toEqual({ kind: 'started', campaignKey: gameKey(next), transition: 'start' });
    expect(subject.state.appState.queue.map(gameKey)).toEqual([gameKey(next)]);
  });

  test('does not announce a completed campaign again on repeated refresh', async () => {
    // Given: a completed favorite with repeatedly regressed campaign data.
    const subject = completedCampaignFixture();

    // When: refresh triggers repeat and coalesce.
    await Promise.all([
      subject.automation.request('campaign-refresh'),
      subject.automation.request('periodic'),
    ]);
    await subject.automation.request('campaign-refresh');

    // Then: no added or started effects occur across evaluations.
    expect(subject.notifications).toEqual([]);
    expect(subject.state.appState.queue).toEqual([]);
  });

  test('does not rediscover or start a completed favorite from regressed Twitch data', async () => {
    // Given: persisted acquisition evidence and a discovery response regressed to zero progress.
    const subject = completedCampaignFixture();

    // When: a normal refresh evaluates the real Twitch adapter, planner and session transition.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: the completed campaign creates no queue entry, session or user-facing event.
    expect({
      outcome,
      queue: subject.state.appState.queue,
      active: subject.state.appState.isRunning,
      notifications: subject.notifications,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      queue: [],
      active: false,
      notifications: [],
    });
  });
});
