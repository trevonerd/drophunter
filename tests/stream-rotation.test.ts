import { registerStreamHealthCases } from './cases/stream-rotation-health.ts';
import { registerStreamRecoveryCases } from './cases/stream-rotation-recovery.ts';
import { registerStreamStallCases } from './cases/stream-rotation-stall.ts';

registerStreamRecoveryCases();
registerStreamHealthCases();
registerStreamStallCases();
