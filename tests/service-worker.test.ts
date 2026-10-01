import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  '[DropHunter] Drops snapshot API skipped: Twitch session missing',
  '[DropHunter] No Twitch session recovered from storage keys',
  '[DropHunter] No eligible streamer found for current Drops; scheduling one retry',
  '[DropHunter] No rewards found after selected game refresh',
  '[DropHunter] No streamer found for selected game',
  '[DropHunter] Parking campaign because no eligible Drops streamer was found',
  '[DropHunter] [TwitchApiClient] No drops-tagged streams found for "Demo Game" (slug: demo-game)',
  '[DropHunter] [TwitchApiClient] No drops-tagged streams found for "Next Game" (slug: next-game)',
]);

import { afterAll, afterEach, beforeEach, describe } from 'bun:test';
import { registerCacheSessionCases } from './cases/service-worker-cache-session.ts';
import { registerInitializationCases } from './cases/service-worker-initialization.ts';
import { registerPopupActivationRecoveryCase } from './cases/service-worker-popup-recovery.ts';
import { registerQueueCases } from './cases/service-worker-queue.ts';
import { registerRecoveryCases } from './cases/service-worker-recovery.ts';
import { registerRefreshLaunchCases } from './cases/service-worker-refresh-launch.ts';
import { registerRefreshReuseCases } from './cases/service-worker-refresh-reuse.ts';
import { registerStartAndSettingsCases } from './cases/service-worker-start-settings.ts';
import { registerUpdateGamesCases } from './cases/service-worker-update-games.ts';
import { registerUpdateLifecycleCase } from './cases/service-worker-update-lifecycle.ts';
import {
  afterEachServiceWorkerTest,
  beforeEachServiceWorkerTest,
  teardownServiceWorkerTests,
} from './helpers/service-worker-harness.ts';

describe('service worker message handlers', () => {
  beforeEach(beforeEachServiceWorkerTest);
  afterEach(afterEachServiceWorkerTest);
  afterAll(teardownServiceWorkerTests);

  registerInitializationCases();
  registerStartAndSettingsCases();
  registerRefreshLaunchCases();
  registerRefreshReuseCases();
  registerCacheSessionCases();
  registerUpdateGamesCases();
  registerRecoveryCases();
  registerQueueCases();
  registerUpdateLifecycleCase();
  registerPopupActivationRecoveryCase();
});
