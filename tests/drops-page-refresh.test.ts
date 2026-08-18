import { describe } from 'bun:test';
import { registerDiscoveredDropsPageRefreshCases } from './cases/drops-page-refresh-discovered.ts';
import { registerNonDiscoveredDropsPageRefreshCases } from './cases/drops-page-refresh-non-discovered.ts';

describe('drops page refresher', () => {
  registerDiscoveredDropsPageRefreshCases();
  registerNonDiscoveredDropsPageRefreshCases();
});
