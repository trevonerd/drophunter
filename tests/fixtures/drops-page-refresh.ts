import { createDropsPageRefresher } from '../../src/background/drops-page-refresh.ts';
import { createInitialState } from '../../src/shared/utils.ts';

type DropsPageState = Parameters<typeof createDropsPageRefresher>[0];
type DropsPageRefreshOptions = Parameters<typeof createDropsPageRefresher>[1];

export interface TabsApiHarness {
  readonly created: string[];
  readonly createdActive: boolean[];
  readonly activated: number[];
  readonly updated: Array<{ tabId: number; properties: { active?: boolean; url?: string } }>;
  setQueryResult(tabs: Array<{ id?: number; discarded?: boolean }>): void;
  query(): Promise<Array<{ id?: number; discarded?: boolean }>>;
  update(tabId: number, properties?: { active?: boolean; url?: string }): Promise<{ id: number }>;
  create(createData: { url: string; active: boolean }): Promise<{ id: number }>;
}

export function createTabsApi(): TabsApiHarness {
  let queryResult: Array<{ id?: number; discarded?: boolean }> = [];
  const created: string[] = [];
  const createdActive: boolean[] = [];
  const activated: number[] = [];
  const updated: Array<{ tabId: number; properties: { active?: boolean; url?: string } }> = [];

  return {
    created,
    createdActive,
    activated,
    updated,
    setQueryResult(tabs) {
      queryResult = tabs;
    },
    async query() {
      return queryResult;
    },
    async update(tabId, properties = {}) {
      updated.push({ tabId, properties });
      if (properties.active) activated.push(tabId);
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
