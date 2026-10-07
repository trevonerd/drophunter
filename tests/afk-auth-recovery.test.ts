import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] Inventory snapshot API skipped: Twitch session missing', 1],
  ['[DropHunter] No Twitch session recovered from storage keys', 1],
  ['[DropHunter] Twitch API auth failed after explicit session recovery: Error: 401 invalid oauth token', 1],
  [
    '[DropHunter] Twitch inventory auth failed after explicit session recovery: Error: 401 invalid oauth token',
    2,
  ],
  ['[DropHunter] Unable to refresh Twitch Client-Integrity token Error: 401 invalid oauth token', 1],
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: Error: 401 invalid oauth token',
    1,
  ],
]);

import './cases/afk-auth-recovery-01.ts';
import './cases/afk-auth-recovery-02.ts';
import './cases/afk-auth-recovery-03.ts';
import './cases/afk-auth-recovery-04.ts';
