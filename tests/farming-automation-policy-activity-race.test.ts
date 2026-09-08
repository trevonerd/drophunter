import { expect, test } from 'bun:test';
import { persistFarmingAutomationPlan } from '../src/background/farming-automation-effects.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';

test('invalidated queue persistence never publishes or stores a proposed discovery activity', async () => {
  const state = createServiceWorkerState();
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => 'initial',
    broadcast: () => undefined,
  });
  const pending = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const originalSet = storage.local.set;
  let first = true;
  storage.local.set = async (items) => {
    if (first) {
      first = false;
      entered.resolve();
      await pending.promise;
    }
    await originalSet(items);
  };
  const game = { id: 'game', campaignId: 'done', name: 'Game', imageUrl: '' };
  const notifications: string[] = [];
  const write = persistFarmingAutomationPlan({
    state,
    persistence,
    queuePlan: {
      queue: [game],
      queueEntryMetadataByKey: {
        'campaign:done': { source: 'favorite-auto', addedAt: 1, reason: 'favorite-discovered' },
      },
      added: [{ game, position: 0 }],
    },
    availability: {},
    now: 1,
    automationNotify: {
      notify: async (event) => {
        notifications.push(event.event);
      },
    },
  });
  await entered.promise;
  state.appState.acquiredCampaignIds = ['done'];
  state.appState.lastAutomationMessage = 'Manual stop preserved';
  pending.resolve();
  expect(await write).toBe(false);
  const restored = normalizeStoredAppState(storage.getLocal('appState'));
  expect(state.appState.automationActivity).toEqual([]);
  expect(restored.automationActivity).toEqual([]);
  expect(state.appState.lastAutomationMessage).toBe('Manual stop preserved');
  expect(restored.lastAutomationMessage).toBe('Manual stop preserved');
  expect(restored.queue).toEqual([]);
  expect(notifications).toEqual([]);
});
