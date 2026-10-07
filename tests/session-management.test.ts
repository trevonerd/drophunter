import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] No Twitch session recovered from storage keys', 2],
  [
    '[DropHunter] Unable to refresh Twitch Client-Integrity token TwitchHttpError: Twitch integrity HTTP 500',
    1,
  ],
  ['[DropHunter] executeScript session extraction failed', 1],
]);

import './cases/session-management-01.ts';
import './cases/session-management-02.ts';
import './cases/session-management-03.ts';
import './cases/session-management-04.ts';
import './cases/session-management-05.ts';
import './cases/session-management-06.ts';
import './cases/session-management-07.ts';
import './cases/session-management-08.ts';
import './cases/session-management-09.ts';
import './cases/session-management-10.ts';
import './cases/session-management-11.ts';
import './cases/session-management-12.ts';
