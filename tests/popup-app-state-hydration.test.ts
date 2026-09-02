import { expect, test } from 'bun:test';
import { hydratePopupStateStaleWhileRevalidate } from '../src/popup/hooks/useAppState.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('cached popup state becomes renderable before activation resolves', async () => {
  const cached = {
    ...createInitialState(),
    isRunning: true,
    selectedGame: { id: 'game-1', name: 'FragPunk', imageUrl: '', campaignId: 'campaign-1' },
  };
  const activated = { ...cached, twitchSessionDetected: true };
  const events: string[] = [];
  let resolveActivation: ((value: { appState: typeof activated }) => void) | null = null;
  const activation = new Promise<{ appState: typeof activated }>((resolve) => {
    resolveActivation = resolve;
  });

  const hydration = hydratePopupStateStaleWhileRevalidate({
    loadCachedState: async () => cached,
    activatePopup: async () => activation,
    applyCachedState: () => events.push('cached'),
    applyActivatedState: () => events.push('activated'),
    finishBootstrap: () => events.push('renderable'),
    reportError: () => events.push('error'),
  });

  await Promise.resolve();
  await Promise.resolve();
  expect(events).toEqual(['cached', 'renderable']);

  resolveActivation?.({ appState: activated });
  await hydration;
  expect(events).toEqual(['cached', 'renderable', 'activated']);
});

test('activation cannot overwrite a repaired running target with null', async () => {
  const queued = { id: 'game-1', name: 'FragPunk', imageUrl: '', campaignId: 'campaign-1' };
  const cached = { ...createInitialState(), isRunning: true, selectedGame: queued, queue: [queued] };
  const invalidActivation = { ...cached, selectedGame: null };
  let applied = cached;

  await hydratePopupStateStaleWhileRevalidate({
    loadCachedState: async () => cached,
    activatePopup: async () => ({ appState: invalidActivation }),
    applyCachedState: (state) => {
      applied = state;
    },
    applyActivatedState: (state) => {
      applied = state;
    },
    finishBootstrap: () => {},
    reportError: () => {},
  });

  expect(applied.selectedGame).toEqual(queued);
});
