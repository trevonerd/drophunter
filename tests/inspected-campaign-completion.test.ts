import { describe, expect, test } from 'bun:test';
import { recomputeKnownCompleteGameSummary } from '../src/background/drops-projection-semantics.ts';
import { handleSetSelectedGame } from '../src/background/drops-tick-selection.ts';
import { removeGameFromQueue, resolveGameFromState } from '../src/background/queue-operations.ts';
import type { TwitchGame } from '../src/types/index.ts';
import { createDrop } from './fixtures/queue-management.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';

describe('inspected acquired campaign evidence', () => {
  test('switching idle inspection preserves acquired favorite before failed refresh and automation', async () => {
    const prepared: string[] = [];
    const subject = fixture('priority-list-only', {
      queue: [],
      onPrepare: () => {
        prepared.push('playback');
      },
    });
    const acquired: TwitchGame = {
      ...subject.favorite,
      dropCount: 1,
      allDropsCompleted: true,
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    };
    subject.state.appState.availableGames = [acquired, subject.manual];
    subject.state.appState.selectedGame = acquired;
    subject.state.appState.allDrops = [
      createDrop({
        id: 'weak-reward',
        gameId: acquired.id,
        campaignId: acquired.campaignId,
      }),
    ];

    await handleSetSelectedGame(
      subject.state,
      { game: subject.manual },
      {
        onTrackActivity: async () => {},
        onEnsureWorkspace: async () => {},
        onRefreshDropsData: async () => ({ kind: 'transient-failure' }),
        onOpenBestStreamer: async () => true,
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
      {
        resolveGameFromState,
        removeGameFromQueue,
        splitDropsForSelectedGame: () => {},
        getGameDisplayLabel: (game) => game.name,
        logDebug: () => {},
        logWarn: () => {},
      },
    );
    const outcome = await subject.automation.request('periodic');

    expect(outcome.kind).not.toBe('started');
    expect(prepared).toEqual([]);
    expect(subject.state.appState.acquiredCampaignIds).toContain(acquired.campaignId);
    expect(
      subject.state.appState.availableGames.find((game) => game.campaignId === acquired.campaignId)
        ?.rewardSummary?.completion,
    ).toBe('all-acquired');
  });

  test('pure recomputation preserves acquired proof against weak reward progress', () => {
    const acquired: TwitchGame = {
      id: 'game',
      name: 'Game',
      imageUrl: '',
      campaignId: 'acquired',
      dropCount: 1,
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    };
    expect(
      recomputeKnownCompleteGameSummary(acquired, [
        createDrop({
          gameId: 'game',
          campaignId: 'acquired',
        }),
      ]),
    ).toEqual(acquired);
  });
});
