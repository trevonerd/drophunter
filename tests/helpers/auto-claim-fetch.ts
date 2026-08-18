import type { SnapshotDropSpec } from '../fixtures/auto-claim-scenarios.ts';

type SnapshotScenario = {
  readonly drops: readonly SnapshotDropSpec[];
};

function futureIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function requiredMinutes(spec: SnapshotDropSpec): number {
  return spec.requiredMinutes ?? 60;
}

function createCampaignDrop(spec: SnapshotDropSpec) {
  return {
    id: spec.dropId,
    name: `${spec.game.name} Reward`,
    requiredMinutesWatched: requiredMinutes(spec),
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
  const minutes = requiredMinutes(spec);
  return {
    id: spec.game.campaignId,
    game: { displayName: spec.game.name, name: spec.game.name },
    timeBasedDrops: [
      {
        id: spec.dropId,
        requiredMinutesWatched: minutes,
        endAt: spec.endsAt ?? futureIso(),
        self: {
          currentMinutesWatched: spec.currentMinutes ?? (minutes > 0 ? minutes : 0),
          isClaimed: spec.claimed ?? false,
          isClaimable: spec.claimable ?? false,
          ...(spec.claimId ? { dropInstanceID: spec.claimId } : {}),
        },
      },
    ],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export class AutoClaimFetch {
  readonly claimRequests: string[] = [];
  private readonly snapshots: SnapshotScenario[] = [];
  private readonly directories: Array<string | null> = [];
  private activeSnapshot: SnapshotScenario | null = null;

  reset(): void {
    this.snapshots.length = 0;
    this.directories.length = 0;
    this.claimRequests.length = 0;
    this.activeSnapshot = null;
    globalThis.fetch = this.fetch;
  }

  enqueueSnapshot(drops: readonly SnapshotDropSpec[]): void {
    this.snapshots.push({ drops });
  }

  enqueueDirectory(streamerName: string | null): void {
    this.directories.push(streamerName);
  }

  isSettled(): boolean {
    return this.snapshots.length === 0 && this.activeSnapshot === null;
  }

  clearSnapshots(): void {
    this.snapshots.length = 0;
    this.activeSnapshot = null;
  }

  private readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    if (Array.isArray(body)) {
      const scenario = this.activeSnapshot;
      if (!scenario) throw new Error('Unexpected campaign details fetch in auto-claim test');
      this.activeSnapshot = null;
      return jsonResponse(
        scenario.drops.map((spec) => ({ data: { user: { dropCampaign: createCampaign(spec) } } })),
      );
    }
    if (url.includes('/integrity')) return jsonResponse({ token: 'integrity-token' });
    if (!body || typeof body !== 'object') throw new Error('Missing GraphQL request body');
    const operationName = Reflect.get(body, 'operationName');

    switch (operationName) {
      case 'ViewerDropsDashboard': {
        const scenario = this.snapshots.shift();
        if (!scenario) throw new Error('Unexpected drops dashboard fetch in auto-claim test');
        this.activeSnapshot = scenario;
        return jsonResponse({
          data: { currentUser: { dropCampaigns: scenario.drops.map(createCampaign) } },
        });
      }
      case 'Inventory': {
        const scenario = this.activeSnapshot ?? this.snapshots.shift();
        if (!scenario) throw new Error('Unexpected inventory fetch in auto-claim test');
        if (this.activeSnapshot && scenario.drops.length === 0) this.activeSnapshot = null;
        return jsonResponse({
          data: {
            currentUser: {
              inventory: {
                dropCampaignsInProgress: scenario.drops.map(createInventoryCampaign),
                gameEventDrops: [],
              },
            },
          },
        });
      }
      case 'DirectoryPage_Game': {
        const streamerName = this.directories.shift();
        if (streamerName === undefined) throw new Error('Unexpected directory fetch in auto-claim test');
        const edges = streamerName
          ? [{ node: { broadcaster: { login: streamerName, displayName: streamerName }, viewersCount: 123 } }]
          : [];
        return jsonResponse({ data: { game: { streams: { edges } } } });
      }
      case 'DropsPage_ClaimDropRewards': {
        const variables = Reflect.get(body, 'variables');
        const inputValue =
          variables && typeof variables === 'object' ? Reflect.get(variables, 'input') : null;
        const claimId =
          inputValue && typeof inputValue === 'object' ? Reflect.get(inputValue, 'dropInstanceID') : null;
        if (typeof claimId === 'string' && claimId.length > 0) this.claimRequests.push(claimId);
        return jsonResponse({ data: { claimDropRewards: { status: 'SUCCESS' } } });
      }
      case 'CoreActionsCurrentUser':
        return jsonResponse({ data: { currentUser: { id: '123456' } } });
      default:
        throw new Error(`Unexpected fetch operation in auto-claim test: ${String(operationName)}`);
    }
  };
}
