import { expect, test } from 'bun:test';
import { FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY } from '../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';

function fixture() {
  const state = createServiceWorkerState();
  const storage = createInMemoryFarmingAutomationStorage();
  const broadcasts: unknown[] = [];
  let revision = 'initial';
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => revision,
    broadcast: (appState) => broadcasts.push(appState),
  });
  const originalSet = storage.local.set;
  let release = () => {};
  let started = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let first = true;
  storage.local.set = async (items) => {
    if (first) {
      first = false;
      started();
      await pending;
    }
    await originalSet(items);
  };
  return {
    state,
    storage,
    broadcasts,
    persistence,
    release,
    entered,
    invalidate: () => {
      revision = 'changed';
    },
  };
}

test('completion arriving during policy persistence survives in memory and storage without success broadcast', async () => {
  const f = fixture();
  const write = f.persistence.savePolicyPatch({
    queue: [{ id: 'game', campaignId: 'done', name: 'Game', imageUrl: '' }],
    queueEntryMetadataByKey: {},
    campaignAvailabilityByKey: {},
  });
  await f.entered;
  f.state.appState.acquiredCampaignIds = ['done'];
  f.release();
  expect((await write).kind).toBe('failed');
  expect(f.state.appState.acquiredCampaignIds).toEqual(['done']);
  expect(f.state.appState.queue).toEqual([]);
  expect(normalizeStoredAppState(f.storage.getLocal('appState')).acquiredCampaignIds).toEqual(['done']);
  expect(f.broadcasts).toEqual([]);
});

test('manual stop and account change arriving during facts persistence survive', async () => {
  const f = fixture();
  f.state.appState.isRunning = true;
  const write = f.persistence.saveFacts({
    version: 1,
    lastPreemption: null,
    manualWatch: null,
    nextEvaluationAt: 123,
    suppressedCampaignKeys: [],
    suppressedUntilByCampaignKey: {},
  });
  await f.entered;
  f.state.appState.isRunning = false;
  f.state.appState.campaignEvidenceUserId = 'new-user';
  f.invalidate();
  f.release();
  expect((await write).kind).toBe('failed');
  expect(f.state.appState.isRunning).toBe(false);
  expect(normalizeStoredAppState(f.storage.getLocal('appState')).campaignEvidenceUserId).toBe('new-user');
});

test('transition invalidated during its durable write cannot commit or leave its receipt', async () => {
  const f = fixture();
  const nextAppState = structuredClone(f.state.appState);
  nextAppState.isRunning = true;
  const write = f.persistence.commitTransition({
    expectedSessionRevision: 'initial',
    nextAppState,
    nextDropsSnapshot: [],
    receipt: {
      version: 1,
      attemptId: 'attempt',
      transition: 'start',
      fromCampaignKey: null,
      toCampaignKey: 'done',
      toStreamerName: 'streamer',
      committedAt: 1,
      sessionRevision: 'initial',
      fromWatch: null,
      toWatch: null,
      cleanup: { kind: 'not-required' },
    },
  });
  await f.entered;
  f.state.appState.acquiredCampaignIds = ['done'];
  f.invalidate();
  f.release();
  expect((await write).kind).toBe('stale');
  expect(f.state.appState.isRunning).toBe(false);
  expect(normalizeStoredAppState(f.storage.getLocal('appState')).acquiredCampaignIds).toEqual(['done']);
  expect(f.storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)).toBeUndefined();
});
