import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] Auto-claim failed, scheduled retry', 3],
  ['[DropHunter] Auto-claim skipped: missing claimId', 1],
  ['[DropHunter] Drop claim attempt failed: TypeError: temporary network failure', 1],
]);

import { registerClaimDropViaApiCases } from './cases/auto-claim-drops-api.ts';
import { registerAutoClaimClaimableDropsCases } from './cases/auto-claim-drops-batch.ts';
import {
  registerAutoClaimGateCases,
  registerAutoClaimSettingCases,
  registerClaimRetryCases,
} from './cases/auto-claim-drops-gates.ts';
import {
  registerMarkDropClaimedInSnapshotCases,
  registerMarkDropClaimedLocallyCases,
} from './cases/auto-claim-drops-marking.ts';

registerAutoClaimSettingCases();
registerAutoClaimGateCases();
registerClaimRetryCases();
registerMarkDropClaimedLocallyCases();
registerMarkDropClaimedInSnapshotCases();
registerClaimDropViaApiCases();
registerAutoClaimClaimableDropsCases();
