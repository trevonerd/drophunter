import type { TwitchGame } from '../../src/types/index.ts';

type MockFetchResponse = {
  json: unknown;
  ok?: boolean;
  status?: number;
};

export type SnapshotDropSpec = {
  game: TwitchGame;
  dropId: string;
  currentMinutes?: number;
  requiredMinutes?: number;
  endsAt?: string;
};

type SnapshotScenario = {
  drops: SnapshotDropSpec[];
};

const snapshotQueue: SnapshotScenario[] = [];
const directoryQueue: Array<string | null> = [];
let activeSnapshotScenario: SnapshotScenario | null = null;

function futureIso(hours = 24) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createCampaignDrop(spec: SnapshotDropSpec) {
  return {
    id: spec.dropId,
    name: `${spec.game.name} Reward`,
    requiredMinutesWatched: spec.requiredMinutes ?? 60,
    endAt: spec.endsAt ?? futureIso(),
    benefitEdges: [],
  };
}

function createCampaign(spec: SnapshotDropSpec) {
  return {
    id: spec.game.campaignId,
    status: 'ACTIVE',
    endAt: spec.endsAt ?? futureIso(),
    game: {
      displayName: spec.game.name,
      name: spec.game.name,
      slug: spec.game.categorySlug,
      boxArtURL: spec.game.imageUrl,
    },
    timeBasedDrops: [createCampaignDrop(spec)],
    eventBasedDrops: [],
  };
}

function createInventoryCampaign(spec: SnapshotDropSpec) {
  return {
    id: spec.game.campaignId,
    game: { displayName: spec.game.name, name: spec.game.name },
    timeBasedDrops: [
      {
        id: spec.dropId,
        requiredMinutesWatched: spec.requiredMinutes ?? 60,
        endAt: spec.endsAt ?? futureIso(),
        self: {
          currentMinutesWatched: spec.currentMinutes ?? 0,
          isClaimed: false,
          isClaimable: false,
        },
      },
    ],
  };
}

export function enqueueDropsSnapshot(dropSpecs: SnapshotDropSpec[]) {
  snapshotQueue.push({ drops: dropSpecs });
}

export function enqueueDirectoryResult(streamerName: string | null) {
  directoryQueue.push(streamerName);
}

export function resetFetchScenarios() {
  snapshotQueue.length = 0;
  directoryQueue.length = 0;
  activeSnapshotScenario = null;
}

export function installFetchMock() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const jsonResponse = (json: unknown, options: Omit<MockFetchResponse, 'json'> = {}) =>
      new Response(JSON.stringify(json), {
        status: options.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });

    if (Array.isArray(body)) {
      const scenario = activeSnapshotScenario;
      if (!scenario) throw new Error('Unexpected campaign details fetch in service-worker test');
      const campaigns = scenario.drops.map((spec) => createCampaign(spec));
      activeSnapshotScenario = null;
      return jsonResponse(campaigns.map((campaign) => ({ data: { user: { dropCampaign: campaign } } })));
    }
    if (url.includes('/integrity')) return jsonResponse({ token: 'integrity-token' });

    switch (body?.operationName) {
      case 'ViewerDropsDashboard': {
        const scenario = snapshotQueue.shift();
        if (!scenario) throw new Error('Unexpected drops dashboard fetch in service-worker test');
        activeSnapshotScenario = scenario;
        return jsonResponse({
          data: { currentUser: { dropCampaigns: scenario.drops.map((spec) => createCampaign(spec)) } },
        });
      }
      case 'Inventory': {
        const scenario = activeSnapshotScenario ?? snapshotQueue.shift();
        if (!scenario) throw new Error('Unexpected inventory fetch in service-worker test');
        if (activeSnapshotScenario && scenario.drops.length === 0) activeSnapshotScenario = null;
        return jsonResponse({
          data: {
            currentUser: {
              inventory: {
                dropCampaignsInProgress: scenario.drops.map((spec) => createInventoryCampaign(spec)),
                gameEventDrops: [],
              },
            },
          },
        });
      }
      case 'DirectoryPage_Game': {
        const streamerName = directoryQueue.shift();
        if (streamerName === undefined) throw new Error('Unexpected directory fetch in service-worker test');
        const edges = streamerName
          ? [{ node: { broadcaster: { login: streamerName, displayName: streamerName }, viewersCount: 123 } }]
          : [];
        return jsonResponse({ data: { game: { streams: { edges } } } });
      }
      case 'DropsPage_ClaimDropRewards':
        return jsonResponse({ data: { claimDropRewards: { status: 'SUCCESS' } } });
      case 'CoreActionsCurrentUser':
        return jsonResponse({ data: { currentUser: { id: '123456' } } });
      default:
        throw new Error(
          `Unexpected fetch operation in service-worker test: ${body?.operationName ?? 'unknown'}`,
        );
    }
  }) satisfies typeof fetch;
}
