import { describe } from 'bun:test';
import {
  registerWatchTransportCoordinatorFailureCases,
  registerWatchTransportCoordinatorStallCases,
} from './cases/watch-transport-coordinator-recovery.ts';
import { registerWatchTransportCoordinatorRestorationCases } from './cases/watch-transport-coordinator-restoration.ts';
import { registerWatchTransportCoordinatorStartCases } from './cases/watch-transport-coordinator-start.ts';

describe('watch transport coordinator', () => {
  registerWatchTransportCoordinatorStartCases();
  registerWatchTransportCoordinatorFailureCases();
  registerWatchTransportCoordinatorRestorationCases();
  registerWatchTransportCoordinatorStallCases();
});
