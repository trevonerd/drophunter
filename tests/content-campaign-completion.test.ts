import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createServiceWorkerContentUtilities } from '../src/background/service-worker-content-utilities.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';

let chrome: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  chrome = setupChromeMocks();
});
afterEach(() => chrome.teardown());

test('content catalog updates retain acquisition through disappearance and stale rediscovery', async () => {
  const subject = fixture('priority-list-only', { queue: [] });
  subject.state.appState.autoStartFavoriteGames = false;
  const completed = {
    ...subject.favorite,
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired' as const, remainderReasons: [] },
  };
  subject.state.appState.availableGames = [completed];
  const utilities = createServiceWorkerContentUtilities(subject.state, {
    automation: subject.automation,
    notify: async () => undefined,
    awaitInitialization: async () => undefined,
    ensureContentScriptOnTab: async () => undefined,
  });
  await utilities.handleUpdateGames([]);
  await utilities.handleUpdateGames([subject.favorite]);
  expect(subject.state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
  expect(subject.state.appState.acquiredCampaignIds).toContain(subject.favorite.campaignId);
  expect(subject.state.appState.queue).toEqual([]);
});

test('content update waits for persisted acquisition evidence to load', async () => {
  const subject = fixture('priority-list-only', { queue: [] });
  subject.state.appState.autoStartFavoriteGames = false;
  const utilities = createServiceWorkerContentUtilities(subject.state, {
    automation: subject.automation,
    notify: async () => undefined,
    awaitInitialization: async () => {
      subject.state.appState.acquiredCampaignIds = [subject.favorite.campaignId ?? ''];
    },
    ensureContentScriptOnTab: async () => undefined,
  });
  await utilities.handleUpdateGames([subject.favorite]);
  expect(subject.state.appState.availableGames[0]?.allDropsCompleted).toBe(true);
});

test('content catalog replacement consumes legacy completion held only by queue selection', async () => {
  const subject = fixture('priority-list-only', { queue: [] });
  subject.state.appState.autoStartFavoriteGames = false;
  const completed = { ...subject.favorite, allDropsCompleted: true };
  subject.state.appState.queue = [completed];
  subject.state.appState.selectedGame = completed;
  const utilities = createServiceWorkerContentUtilities(subject.state, {
    automation: subject.automation,
    notify: async () => undefined,
    awaitInitialization: async () => undefined,
    ensureContentScriptOnTab: async () => undefined,
  });
  await utilities.handleUpdateGames([subject.favorite]);
  expect(subject.state.appState.availableGames[0]?.allDropsCompleted).toBe(true);
});
