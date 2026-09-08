import { describe, expect, test } from 'bun:test';
import { refreshGamesCacheFromHiddenFetch } from '../src/background/games-cache-orchestration.ts';
import { normalizeQueueSelection } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchGame } from '../src/types/index.ts';
import { makeGamesCacheDeps as makeDeps, selectedCampaign } from './fixtures/games-cache-orchestration.ts';

describe('games cache queue cleanup', () => {
  test('does not commit a late response', async () => {
    const state = createServiceWorkerState();
    state.appState.availableGames = [selectedCampaign];
    const deps = makeDeps({ games: [], drops: [], updatedAt: 1 }, { count: 0 });
    expect(await refreshGamesCacheFromHiddenFetch(state, { isCurrent: () => false }, deps)).toEqual({
      kind: 'unavailable',
      games: [selectedCampaign],
    });
  });

  test.each([false])('rejects an empty partial snapshot: %p', async (campaignsVerified) => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = selectedCampaign;
    state.appState.queue = [selectedCampaign];
    const deps = makeDeps(
      {
        games: [],
        drops: [],
        ...(campaignsVerified === undefined ? {} : { campaignsVerified }),
        updatedAt: 1,
      },
      { count: 0 },
    );
    let unavailable = 0;
    deps.onAuthoritativeCampaignUnavailable = async () => {
      unavailable += 1;
    };
    expect(await refreshGamesCacheFromHiddenFetch(state, {}, deps)).toMatchObject({
      authoritativeEmpty: false,
    });
    expect(unavailable).toBe(0);
    expect(state.appState.queue).toEqual([selectedCampaign]);
  });

  test('removes only IDs absent from a complete campaign catalog and persists before delivery', async () => {
    const state = createServiceWorkerState();
    const unavailable: TwitchGame = { ...selectedCampaign, campaignId: 'unavailable' };
    const retained: TwitchGame = { ...selectedCampaign, campaignId: 'retained' };
    state.appState.queue = [unavailable, retained];
    const deps = makeDeps(
      {
        games: [retained],
        drops: [],
        campaignsVerified: true,
        authoritativeCampaignIds: ['retained'],
        updatedAt: 1,
      },
      { count: 0 },
    );
    deps.normalizeQueueSelection = normalizeQueueSelection;
    const events: string[] = [];
    deps.saveState = async () => {
      events.push('saved');
    };
    deps.onQueueCampaignsRemoved = async () => {
      events.push('notified');
      throw new Error('offline');
    };
    await refreshGamesCacheFromHiddenFetch(state, {}, deps);
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['retained']);
    expect(events).toEqual(['saved', 'notified']);
  });
});
