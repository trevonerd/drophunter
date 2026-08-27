import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildCampaignDetailsResponse,
  buildDropsDashboardResponse,
  buildInventoryResponse,
  createGame,
  createMinimalState,
  createSession,
  type FetchMock,
  installFetchMock,
  restoreFetch,
} from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;

describe('fetchDropsSnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('returns an authoritative empty snapshot when refreshed campaign data has no games or drops', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [] } } }),
      async () => buildInventoryResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(result?.games).toEqual([]);
    expect(result?.drops).toEqual([]);
  });

  test('increments apiConsecutiveFailures and sets apiBackoffUntil on network error', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 0 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => {
        throw new Error('network error');
      },
    ]);

    const before = Date.now();
    const result = await fetchDropsSnapshotFromApi(state, session);
    const after = Date.now();

    expect(result).toBeNull();
    expect(state.apiConsecutiveFailures).toBe(1);
    expect(state.apiBackoffUntil).toBeGreaterThanOrEqual(before);
    expect(state.apiBackoffUntil).toBeLessThanOrEqual(after + 60 * 1000);
  });

  test('rethrows auth errors so wrappers can refresh the Twitch session', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 0 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => {
        throw new Error('401 unauthorized');
      },
    ]);

    await expect(fetchDropsSnapshotFromApi(state, session)).rejects.toThrow('401 unauthorized');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('backoff is capped at 10 minutes with high failure count', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 5 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => {
        throw new Error('network error');
      },
    ]);

    await fetchDropsSnapshotFromApi(state, session);

    expect(state.apiBackoffUntil).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
  });

  test('uses existing integrity token when integrityFallbackActive and not expired', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() + 60_000,
    });
    const session = createSession({ clientIntegrity: 'some-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('calls ensureSessionIntegrity when integrityFallbackActive is expired', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() - 1000,
    });
    const session = createSession({ clientIntegrity: 'some-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('handles integrity error by refreshing token and retrying', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession({ clientIntegrity: 'original-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount++;
      if (fetchCount <= 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: null, errors: [{ message: 'integrity check failed' }] }),
          text: async () => JSON.stringify({ data: null, errors: [{ message: 'integrity check failed' }] }),
        } as Response;
      }
      if (fetchCount === 3) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'refreshed-integrity-token' }),
          text: async () => JSON.stringify({ token: 'refreshed-integrity-token' }),
        } as Response;
      }
      const responses = [
        buildDropsDashboardResponse([game]),
        buildInventoryResponse(),
        buildCampaignDetailsResponse(),
      ];
      const response = responses[fetchCount - 4] ?? buildDropsDashboardResponse([game]);
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as Response;
    };

    const result = await fetchDropsSnapshotFromApi(state, session);

    globalThis.fetch = originalFetch;

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });
});
