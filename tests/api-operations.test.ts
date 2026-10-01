import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchHttpError: Twitch gql HTTP 429',
  '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchInvalidResponseError: integrity check failed',
  '[DropHunter] [TwitchApiClient] Inventory fetch failed, proceeding without inventory: TwitchInvalidResponseError: integrity error',
  '[DropHunter] [TwitchApiClient] No drops-tagged streams found for "Test Game" (slug: test-game)',
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
