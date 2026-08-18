import { afterAll, afterEach, beforeEach, describe } from 'bun:test';
import { registerAutoClaimClaimingCases } from './helpers/auto-claim-claiming-cases.ts';
import { registerAutoClaimFilteringCases } from './helpers/auto-claim-filtering-cases.ts';
import { createAutoClaimHarness } from './helpers/auto-claim-worker.ts';

const harness = await createAutoClaimHarness();

describe('auto-claim cross-game alarm integration', () => {
  beforeEach(harness.beforeEach);
  afterEach(harness.afterEach);
  afterAll(harness.teardown);

  registerAutoClaimClaimingCases(harness);
  registerAutoClaimFilteringCases(harness);
});
