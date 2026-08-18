import { createDropsPageRefresher } from '../../src/background/drops-page-refresh.ts';
import { createInitialState } from '../../src/shared/utils.ts';

type DropsPageState = Parameters<typeof createDropsPageRefresher>[0];
type DropsPageRefreshOptions = Parameters<typeof createDropsPageRefresher>[1];

export interface TabsApiHarness {
  readonly created: string[];
  readonly createdActive: boolean[];
  readonly activated: number[];
  setQueryResult(tabs: Array<{ id?: number }>): void;
  query(): Promise<Array<{ id?: number }>>;
  update(tabId: number): Promise<{ id: number }>;
  create(createData: { url: string; active: boolean }): Promise<{ id: number }>;
}

export function createTabsApi(): TabsApiHarness {
  let queryResult: Array<{ id?: number }> = [];
  const created: string[] = [];
  const createdActive: boolean[] = [];
  const activated: number[] = [];

  return {
    created,
    createdActive,
    activated,
    setQueryResult(tabs) {
      queryResult = tabs;
    },
    async query() {
      return queryResult;
    },
    async update(tabId) {
      activated.push(tabId);
      return { id: tabId };
    },
    async create(createData) {
      created.push(createData.url);
      createdActive.push(createData.active);
      return { id: 42 };
    },
  };
}

export function createDropsPageState(): DropsPageState {
  return { appState: createInitialState() };
}

export function setDiscoveredGame(state: DropsPageState): void {
  state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
}

export function createTestRefresher(
  state: DropsPageState,
  tabsApi: TabsApiHarness,
  overrides: Partial<DropsPageRefreshOptions> = {},
) {
  return createDropsPageRefresher(state, {
    tabsApi,
    trackActivity: async () => {},
    ensureStateHydratedForCache: async () => {},
    waitForTabComplete: async () => {},
    persistSessionFromDropsPage: async () => ({
      oauthToken: 'token',
      deviceId: 'device',
      uuid: 'uuid',
    }),
    refreshGamesCacheFromHiddenFetch: async () => ({
      kind: 'refreshed' as const,
      games: state.appState.availableGames,
    }),
    saveState: async () => {},
    broadcastStateUpdate: () => {},
    ...overrides,
  });
}
