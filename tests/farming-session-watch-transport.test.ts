import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([]);

import './cases/farming-session-watch-transport-01.ts';
import './cases/farming-session-watch-transport-02.ts';
import './cases/farming-session-watch-transport-03.ts';
import './cases/farming-session-watch-transport-05.ts';
import './cases/farming-session-watch-transport-06.ts';
import './cases/farming-session-watch-transport-07.ts';
