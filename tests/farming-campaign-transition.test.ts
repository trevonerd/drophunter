import { describe, expect, test } from 'bun:test';
import type { RefreshDropsOutcome } from '../src/background/drops-tick-refresh.ts';
import { createFarmingCampaignTransition } from '../src/background/farming-campaign-transition.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import type { PreparedWatch } from '../src/background/watch-transport-transition.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

verifyExpectedDiagnostics([
  ['[DropHunter] Unable to save timing state after the campaign watch was promoted', 1],
  ['[DropHunter] Unable to finalize persisted state after the campaign watch was promoted', 1],
]);

function fixture(refreshOutcome: RefreshDropsOutcome = 'refreshed') {
  const state = createMinimalState();
  const incumbent = createGame({ id: 'smite', campaignId: 'smite-campaign' });
  const candidate = createGame({ id: 'r6', campaignId: 'r6-campaign' });
  state.appState.isRunning = true;
  state.appState.selectedGame = incumbent;
  state.appState.activeStreamer = createStreamer({ name: 'smite-streamer' });
  state.appState.availableGames = [incumbent, candidate];
  state.appState.queue = [incumbent, candidate];
  state.cachedDropsSnapshot = [
    createDrop({ gameId: candidate.id, campaignId: candidate.campaignId, requiredMinutes: 60 }),
  ];
  let current = true;
  let prepares = 0;
  let disposals = 0;
  let promotions = 0;
  let cancelDuringPreparation = false;
  let changeSettingsDuringSave = false;
  let rejectTiming = false;
  let duringPreparation: (() => void) | undefined;
  let duringCandidateSave: (() => void) | undefined;
  let rejectCommittedSave = false;
  const saves: { deferred: boolean; promotions: number }[] = [];
  const health = {
    mode: 'managed-tab' as const,
    status: 'healthy' as const,
    reason: 'started' as const,
    isHealthy: true,
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress: 0,
    shouldFallback: false,
    checkedAt: 1,
  };
  const context = createFarmingSessionContext(
    state,
    createFarmingSessionAdapters({
      fetchDirectoryStreamersFromApi: async () =>
        Object.assign([createStreamer({ name: 'r6-streamer' })], { languageFilterApplied: true }),
      saveState: async (next, options) => {
        saves.push({ deferred: options?.deferPublicEffects ?? false, promotions });
        if (next === state && promotions > 0 && rejectCommittedSave)
          throw new Error('final state write failed');
        if (next !== state && changeSettingsDuringSave) state.appState.notificationsEnabled = true;
        if (next !== state) duringCandidateSave?.();
      },
      saveTimingState: async () => {
        if (rejectTiming) throw new Error('timing write failed');
      },
      watchTransport: {
        start: async () => ({ kind: 'started', health }),
        tick: async () => health,
        stop: async () => {},
        setPreference: async () => {},
        prepare: async (target) => {
          prepares += 1;
          duringPreparation?.();
          const ownership = {
            kind: 'managed-tab' as const,
            tabId: 18,
            ownershipToken: 'r6-owner',
            expectedChannel: target.channelName,
          };
          const watch: PreparedWatch = {
            target,
            ownership,
            health,
            fallbackReason: null,
            promote: () => {
              promotions += 1;
              return { kind: 'promoted', ownership, obsolete: null };
            },
            dispose: async () => {
              disposals += 1;
            },
          };
          if (cancelDuringPreparation) current = false;
          return { kind: 'prepared', watch };
        },
      },
    }),
  );
  const transition = createFarmingCampaignTransition(context, async () => refreshOutcome);
  return {
    state,
    incumbent,
    candidate,
    adapters: context.adapters,
    transition: () => transition(candidate, () => current),
    cancelPreparation: () => {
      cancelDuringPreparation = true;
    },
    changeSettings: () => {
      changeSettingsDuringSave = true;
    },
    rejectTiming: () => {
      rejectTiming = true;
    },
    duringPreparation: (effect: () => void) => {
      duringPreparation = effect;
    },
    duringCandidateSave: (effect: () => void) => {
      duringCandidateSave = effect;
    },
    rejectCommittedSave: () => {
      rejectCommittedSave = true;
    },
    saves,
    counts: () => ({ prepares, disposals, promotions }),
  };
}

describe('campaign transition staging guards', () => {
  test.each(['transient-failure', 'auth-required'] as const)(
    'cannot start from cached evidence after %s',
    async (outcome) => {
      const subject = fixture(outcome);
      expect(await subject.transition()).toMatchObject({ kind: 'failed', reason: 'directory-unavailable' });
      expect(subject.counts()).toEqual({ prepares: 0, disposals: 0, promotions: 0 });
      expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
    },
  );

  test('disposes preparation cancelled before streamer acquisition returns', async () => {
    const subject = fixture();
    subject.cancelPreparation();
    expect(await subject.transition()).toEqual({ kind: 'cancelled' });
    expect(subject.counts()).toEqual({ prepares: 1, disposals: 1, promotions: 0 });
    expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
  });

  test('does not overwrite settings changed during the candidate storage write', async () => {
    const subject = fixture();
    subject.state.appState.notificationsEnabled = false;
    subject.changeSettings();
    expect(await subject.transition()).toEqual({ kind: 'cancelled' });
    expect(subject.state.appState.notificationsEnabled).toBe(true);
    expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
    expect(subject.counts().promotions).toBe(0);
    expect(subject.counts().disposals).toBe(1);
  });

  test('a timing storage failure cannot report failure after the actual watch was promoted', async () => {
    const subject = fixture();
    subject.rejectTiming();
    expect(await subject.transition()).toEqual({ kind: 'started' });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.candidate.campaignId);
    expect(subject.state.appState.activeStreamer?.name).toBe('r6-streamer');
    expect(subject.counts()).toEqual({ prepares: 1, disposals: 0, promotions: 1 });
  });

  test('reuses current generation campaign proof without repeating campaign or inventory requests', async () => {
    const subject = fixture();
    subject.state.hasCurrentGenerationCampaignValidation = true;
    let requests = 0;
    const session = createFarmingSession(subject.state, {
      ...subject.adapters,
      fetchDropsSnapshotFromApi: async () => {
        requests += 1;
        return null;
      },
      fetchInventorySnapshotFromApi: async () => {
        requests += 1;
        return null;
      },
    });
    expect(await session.handleSetSelectedGame({ game: subject.candidate })).toEqual({ success: true });
    expect(requests).toBe(0);
    expect(subject.state.hasCurrentGenerationCampaignValidation).toBe(true);
    expect(subject.state.appState.currentDrop?.campaignId).toBe(subject.candidate.campaignId);
  });

  test('revalidates campaign evidence when the current worker generation has no proof', async () => {
    const subject = fixture();
    subject.state.hasCurrentGenerationCampaignValidation = false;
    let campaigns = 0;
    let inventory = 0;
    const session = createFarmingSession(subject.state, {
      ...subject.adapters,
      fetchDropsSnapshotFromApi: async () => {
        campaigns += 1;
        return {
          games: subject.state.appState.availableGames,
          drops: subject.state.cachedDropsSnapshot,
          updatedAt: Date.now(),
          campaignsVerified: true,
        };
      },
      fetchInventorySnapshotFromApi: async () => {
        inventory += 1;
        return null;
      },
    });
    expect(await session.handleSetSelectedGame({ game: subject.candidate })).toEqual({ success: true });
    expect(campaigns).toBe(1);
    expect(inventory).toBe(0);
    expect(subject.state.hasCurrentGenerationCampaignValidation).toBe(true);
  });

  test('a validated incumbent snapshot still fetches missing successor rewards before promotion', async () => {
    const subject = fixture();
    const candidateDrops = subject.state.cachedDropsSnapshot;
    subject.state.hasCurrentGenerationCampaignValidation = true;
    subject.state.cachedDropsSnapshot = [
      createDrop({ gameId: subject.incumbent.id, campaignId: subject.incumbent.campaignId }),
    ];
    let requests = 0;
    const session = createFarmingSession(subject.state, {
      ...subject.adapters,
      fetchDropsSnapshotFromApi: async () => {
        requests += 1;
        return {
          games: subject.state.appState.availableGames,
          drops: candidateDrops,
          updatedAt: Date.now(),
          campaignsVerified: true,
        };
      },
    });
    expect(await session.handleSetSelectedGame({ game: subject.candidate })).toEqual({ success: true });
    expect(requests).toBe(1);
    expect(subject.state.appState.pendingDrops[0]?.campaignId).toBe(subject.candidate.campaignId);
    expect(subject.state.appState.currentDrop?.campaignId).toBe(subject.candidate.campaignId);
  });

  test('missing successor reward evidence cannot be classified as absent streamers', async () => {
    const subject = fixture();
    subject.state.cachedDropsSnapshot = [];
    expect(await subject.transition()).toMatchObject({ kind: 'failed', reason: 'directory-unavailable' });
    expect(subject.counts()).toEqual({ prepares: 0, disposals: 0, promotions: 0 });
    expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
  });

  test('preserves newer campaign progress and minutes received while playback prepares', async () => {
    const subject = fixture();
    const drop = subject.state.cachedDropsSnapshot[0];
    if (!drop) throw new Error('Expected candidate reward');
    subject.duringPreparation(() => {
      subject.state.cachedDropsSnapshot = [{ ...drop, progress: 90, currentMinutes: 54 }];
      subject.state.appState.campaignDropsByKey['campaign:r6-campaign'] = [drop];
      subject.state.appState.totalDropsClaimed = 13;
    });
    expect(await subject.transition()).toEqual({ kind: 'started' });
    expect(subject.state.appState.currentDrop).toMatchObject({ progress: 90, currentMinutes: 54 });
    expect(subject.state.cachedDropsSnapshot[0]).toMatchObject({ progress: 90, currentMinutes: 54 });
    expect(subject.state.appState.totalDropsClaimed).toBe(13);
  });

  test.each(['claimed-reward', 'campaign-evidence'] as const)(
    'disposes playback if its campaign becomes acquired while preparation awaits: %s',
    async (source) => {
      const subject = fixture();
      const drop = subject.state.cachedDropsSnapshot[0];
      if (!drop) throw new Error('Expected candidate reward');
      subject.duringPreparation(() => {
        if (source === 'claimed-reward') {
          subject.state.cachedDropsSnapshot = [{ ...drop, claimed: true, progress: 100, currentMinutes: 60 }];
        } else subject.state.appState.acquiredCampaignIds = [subject.candidate.campaignId ?? ''];
      });
      expect(await subject.transition()).toEqual({ kind: 'completed' });
      expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
      expect(subject.counts()).toEqual({ prepares: 1, disposals: 1, promotions: 0 });
      if (source === 'claimed-reward') expect(subject.state.cachedDropsSnapshot[0]?.claimed).toBe(true);
    },
  );

  test('a claimed duplicate reward from another campaign cannot complete the prepared campaign', async () => {
    const subject = fixture();
    const drop = subject.state.cachedDropsSnapshot[0];
    if (!drop) throw new Error('Expected candidate reward');
    subject.duringPreparation(() => {
      subject.state.cachedDropsSnapshot = [
        drop,
        { ...drop, campaignId: 'another-campaign', progress: 100, claimed: true },
      ];
    });
    expect(await subject.transition()).toEqual({ kind: 'started' });
    expect(subject.state.appState.currentDrop).toMatchObject({
      campaignId: subject.candidate.campaignId,
      claimed: false,
      progress: 0,
    });
    expect(subject.counts().promotions).toBe(1);
  });

  test('cancels the prepared promotion when cache-only reward evidence arrives during storage', async () => {
    const subject = fixture();
    const drop = subject.state.cachedDropsSnapshot[0];
    if (!drop) throw new Error('Expected candidate reward');
    subject.duringCandidateSave(() => {
      subject.state.cachedDropsSnapshot = [{ ...drop, progress: 90, currentMinutes: 54 }];
    });
    expect(await subject.transition()).toEqual({ kind: 'cancelled' });
    expect(subject.state.appState.selectedGame).toBe(subject.incumbent);
    expect(subject.state.cachedDropsSnapshot[0]?.progress).toBe(90);
    expect(subject.counts()).toEqual({ prepares: 1, disposals: 1, promotions: 0 });
  });

  test('finalizes the live recovery and publication effects only after promotion', async () => {
    const subject = fixture();
    expect(await subject.transition()).toEqual({ kind: 'started' });
    expect(subject.saves).toEqual([
      { deferred: true, promotions: 0 },
      { deferred: false, promotions: 1 },
    ]);
  });

  test('a post-promotion state write failure cannot roll back or report a committed watch as failed', async () => {
    const subject = fixture();
    subject.rejectCommittedSave();
    expect(await subject.transition()).toEqual({ kind: 'started' });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.candidate.campaignId);
    expect(subject.counts()).toEqual({ prepares: 1, disposals: 0, promotions: 1 });
  });
});
