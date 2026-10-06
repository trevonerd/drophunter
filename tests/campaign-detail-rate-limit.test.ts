import { expect, test } from 'bun:test';
import { fetchCampaignDetailsBatch } from '../src/background/twitch-api/campaign-detail-batches';
import { TwitchHttpError } from '../src/background/twitch-api/errors';

test('campaign detail rate limits abort the refresh and prevent further batches or progress snapshots', async () => {
  const rateLimit = new TwitchHttpError('gql', 429, 120_000);
  let requests = 0;
  let progressSnapshots = 0;
  await expect(
    fetchCampaignDetailsBatch(
      {
        postAuthorizedBatch: async () => {
          requests++;
          if (requests === 1) throw rateLimit;
          return [];
        },
      },
      {
        campaignIds: Array.from({ length: 45 }, (_, index) => `campaign-${index}`),
        channelLogin: 'viewer',
        cache: new Map(),
        onProgress: async () => {
          progressSnapshots++;
        },
      },
    ),
  ).rejects.toBe(rateLimit);
  expect(requests).toBe(2);
  expect(progressSnapshots).toBe(0);
});
