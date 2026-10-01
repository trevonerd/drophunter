import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  '[DropHunter] Drops snapshot API skipped: Twitch session missing',
  '[DropHunter] No Twitch session recovered from storage keys',
  '[DropHunter] Removing campaign after an authoritative refresh proved it unfarmable',
]);

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
