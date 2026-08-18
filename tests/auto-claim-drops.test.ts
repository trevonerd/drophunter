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
