import { afterAll, afterEach, beforeEach, describe } from 'bun:test';
import { registerCacheSessionCases } from './cases/service-worker-cache-session.ts';
import { registerInitializationCases } from './cases/service-worker-initialization.ts';
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
});
