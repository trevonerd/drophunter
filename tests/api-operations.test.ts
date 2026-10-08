import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: Error: 401 unauthorized',
    2,
  ],
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: Error: invalid oauth token',
    2,
  ],
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchHttpError: Twitch gql HTTP 429',
    2,
  ],
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchInvalidResponseError: integrity check failed',
    1,
  ],
  [
    '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchInvalidResponseError: integrity error',
    2,
  ],
  ['[DropHunter] [TwitchApiClient] No drops-tagged streams found for "Test Game" (slug: test-game)', 1],
  ['[DropHunter] Twitch API auth failed after explicit session recovery: Error: invalid oauth token', 4],
  ['[DropHunter] Twitch session has no userId — attempting auto-detect', 3],
  [
    '[DropHunter] Failed to auto-detect userId: transient error, will retry Error: Twitch GQL request timed out.',
    1,
  ],
  ['[DropHunter] Failed to auto-detect userId: auth error Error: 401 invalid oauth token', 1],
  ['[DropHunter] Could not auto-detect userId — user may not be logged in', 1],
  ['[DropHunter] Drops snapshot API skipped: Twitch session missing', 1],
  [
    '[DropHunter] Twitch inventory auth failed after explicit session recovery: Error: invalid oauth token',
    1,
  ],
  ['[DropHunter] Inventory snapshot API skipped: Twitch session missing', 1],
  ['[DropHunter] Twitch API directory fetch failed: Error: directory unavailable', 1],
]);

import './cases/api-operations-01.ts';
import './cases/api-operations-02.ts';
import './cases/api-operations-03.ts';
import './cases/api-operations-04.ts';
import './cases/api-operations-05.ts';
import './cases/api-operations-06.ts';
import './cases/api-operations-07.ts';
import './cases/api-operations-08.ts';
import './cases/api-operations-09.ts';
import './cases/api-operations-10.ts';
import './cases/api-operations-11.ts';
import './cases/api-operations-12.ts';
import './cases/api-operations-13.ts';
import './cases/api-operations-14.ts';
import './cases/api-operations-15.ts';
import './cases/api-operations-16.ts';
import './cases/api-operations-17.ts';
