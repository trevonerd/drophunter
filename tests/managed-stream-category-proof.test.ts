import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { evaluateStreamHealth } from '../src/background/streamer-health-evaluation.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test.each([
  {
    name: 'missing campaign slug uses the acquired target category',
    slug: undefined,
    selectedId: 'campaign-one',
    observedSlug: 'overwatch-2',
    observedLabel: 'Overwatch',
    healthy: true,
  },
  {
    name: 'renamed URL retains exact canonical category name',
    slug: 'overwatch-2',
    selectedId: 'campaign-one',
    observedSlug: 'overwatch',
    observedLabel: 'Overwatch',
    healthy: true,
  },
  {
    name: 'matching selected ID is not evidence of observed game',
    slug: 'overwatch-2',
    selectedId: '515025',
    observedSlug: 'just-chatting',
    observedLabel: 'Just Chatting',
    healthy: false,
  },
])('$name', async ({ slug, selectedId, observedSlug, observedLabel, healthy }) => {
  const chrome = setupChromeMocks();
  const state = createServiceWorkerState();
  const selected = createGame({
    id: selectedId,
    name: 'Overwatch',
    campaignId: 'one',
    categoryId: '515025',
    categorySlug: slug,
  });
  state.appState.selectedGame = selected;
  state.appState.isRunning = true;
  const events = createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async () => ({
      channelName: 'ml7support',
      categorySlug: observedSlug,
      categoryLabel: observedLabel,
      streamTitle: 'Drops',
      titleContainsDrops: true,
      hasDropsSignal: true,
      isLive: true,
      isPlaybackReady: true,
      pageUrl: 'https://www.twitch.tv/ml7support',
    }),
    heartbeat: async () => ({ accepted: false }),
    notify: async () => {},
    notifyQueueComplete: async () => {},
    clearQueueCompleteNotification: async () => {},
  });
  events.watchTransport.adopt({
    target: {
      gameId: '515025',
      selectionId: selectedId,
      campaignId: 'one',
      categorySlug: 'overwatch-2',
      categoryName: 'Overwatch',
      channelName: 'ml7support',
    },
    ownership: { kind: 'managed-tab', tabId: 10, ownershipToken: 'proof', expectedChannel: 'ml7support' },
    health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
    obsolete: null,
  });
  try {
    const health = await events.watchTransport.tick();
    expect(health.isHealthy).toBe(healthy);
    if (!healthy) expect(health.reason).toBe('wrong-game');
  } finally {
    chrome.teardown();
  }
});

test.each([
  { slug: 'overwatch', label: 'Overwatch', reason: null },
  { slug: 'overwatch-2', label: 'Overwatch', reason: null },
  { slug: 'just-chatting', label: 'Just Chatting', reason: 'wrong-game' },
  { slug: '', label: '', reason: null },
])('stream rotation evaluates observed category $slug without treating missing context as a proven mismatch', async ({
  slug,
  label,
  reason,
}) => {
  const state = createServiceWorkerState();
  state.appState.selectedGame = createGame({ name: 'Overwatch', categorySlug: 'overwatch-2' });
  const result = await evaluateStreamHealth(
    state,
    {
      channelName: 'ml7support',
      categorySlug: slug,
      categoryLabel: label,
      streamTitle: 'Live',
      titleContainsDrops: false,
      hasDropsSignal: false,
      isLive: true,
      pageUrl: 'https://www.twitch.tv/ml7support',
    },
    60_000,
    Date.now(),
    { onResolveCategorySlug: async () => 'overwatch-2' },
  );
  expect(result.health.reason).toBe(reason);
});
