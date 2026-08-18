import { describe, expect, test } from 'bun:test';
import { queueContainsGame, resolveGameFromState } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue03Part01() {
  describe('resolveGameFromState', () => {
    test('returns resolved game when found in availableGames', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1', name: 'Test Game' });
      const resolved = createGame({ id: 'game-1', name: 'Test Game', campaignId: 'campaign-1' });
      state.appState.availableGames = [resolved];
      const result = resolveGameFromState(state, game);
      expect(result?.campaignId).toBe('campaign-1');
    });

    test('returns original game when not found in availableGames', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1', name: 'Test Game' });
      state.appState.availableGames = [];
      const result = resolveGameFromState(state, game);
      expect(result?.id).toBe('game-1');
    });

    test('falls back to name matching when exact match not found', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'old-id', name: 'Test Game' });
      const nameMatch = createGame({ id: 'new-id', name: 'Test Game', campaignId: 'campaign-1' });
      state.appState.availableGames = [nameMatch];
      const result = resolveGameFromState(state, game);
      expect(result?.id).toBe('new-id');
    });

    test('prefers campaigns without campaignId over those with', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'old-id', name: 'Test Game' });
      const withoutCampaign = createGame({ id: 'new-1', name: 'Test Game' });
      const withCampaign = createGame({ id: 'new-2', name: 'Test Game', campaignId: 'campaign-1' });
      state.appState.availableGames = [withCampaign, withoutCampaign];
      const result = resolveGameFromState(state, game);
      expect(result?.id).toBe('new-1');
    });

    test('does not rebind an explicit missing campaign to a sibling by name', () => {
      const state = createMinimalState();
      const requestedCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-missing',
      });
      const siblingCampaign = createGame({
        id: 'canonical-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-sibling',
      });
      state.appState.availableGames = [siblingCampaign];

      expect(resolveGameFromState(state, requestedCampaign)).toBeNull();
    });

    test('resolves an explicit campaign from the queue when availableGames is stale', () => {
      const state = createMinimalState();
      const queuedCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-queued',
      });
      const requestedCampaign = { ...queuedCampaign };
      state.appState.availableGames = [];
      state.appState.queue = [queuedCampaign];

      expect(resolveGameFromState(state, requestedCampaign)).toBe(queuedCampaign);
    });

    test('keeps explicit campaign queue identity distinct from a sibling with the same name', () => {
      const state = createMinimalState();
      const queuedCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-queued',
      });
      const siblingCampaign = createGame({
        id: 'canonical-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-sibling',
      });
      state.appState.availableGames = [siblingCampaign];
      state.appState.queue = [queuedCampaign];

      expect(queueContainsGame(state, siblingCampaign)).toBe(false);
    });
  });
}
