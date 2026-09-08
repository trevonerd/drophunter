import { logWarn } from '../logging';
import { normalizeText } from './parsing';
import { isLikelyAuthError } from './types';

const CAMPAIGN_DETAILS_HASH = '039277bf98f3130929262cc7c6efd9c141ca3749cb6dca442fc8ead9a53f77c1';
const CAMPAIGN_DETAILS_BATCH_SIZE = 20;
const CAMPAIGN_DETAILS_MAX_CONCURRENCY = 2;

export interface CampaignDetailsTransport {
  postAuthorizedBatch<T>(queries: Record<string, unknown>[]): Promise<Array<{ data?: T }>>;
}

export interface CampaignDetailsBatchRequest {
  readonly campaignIds: readonly string[];
  readonly channelLogin: string;
  readonly cache: Map<string, Record<string, unknown>>;
  readonly onProgress?: (
    detailsMap: ReadonlyMap<string, Record<string, unknown>>,
    failedBatches: number,
  ) => Promise<void>;
}

export interface CampaignDetailsBatchResult {
  readonly detailsMap: Map<string, Record<string, unknown>>;
  readonly failedBatches: number;
}

function buildCampaignDetailsQuery(campaignId: string, channelLogin: string): Record<string, unknown> {
  return {
    operationName: 'DropCampaignDetails',
    variables: { dropID: campaignId, channelLogin },
    extensions: { persistedQuery: { version: 1, sha256Hash: CAMPAIGN_DETAILS_HASH } },
  };
}

function buildDetailsMap(
  campaignIds: readonly string[],
  fetchedDetails: ReadonlyMap<string, Record<string, unknown>>,
  cache: ReadonlyMap<string, Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const detailsMap = new Map<string, Record<string, unknown>>();
  campaignIds.forEach((campaignId) => {
    const details = fetchedDetails.get(campaignId) ?? cache.get(campaignId);
    if (details) detailsMap.set(campaignId, details);
  });
  return detailsMap;
}

export async function fetchCampaignDetailsBatch(
  transport: CampaignDetailsTransport,
  request: CampaignDetailsBatchRequest,
): Promise<CampaignDetailsBatchResult> {
  const campaignIds = Array.from(new Set(request.campaignIds));
  const chunks = Array.from(
    { length: Math.ceil(campaignIds.length / CAMPAIGN_DETAILS_BATCH_SIZE) },
    (_, index) =>
      campaignIds.slice(index * CAMPAIGN_DETAILS_BATCH_SIZE, (index + 1) * CAMPAIGN_DETAILS_BATCH_SIZE),
  );
  const fetchedDetails = new Map<string, Record<string, unknown>>();
  let failedBatches = 0;
  let nextChunkIndex = 0;
  const fetchNextBatch = async (): Promise<void> => {
    while (nextChunkIndex < chunks.length) {
      const chunk = chunks[nextChunkIndex];
      nextChunkIndex += 1;
      if (!chunk) return;
      try {
        const results = await transport.postAuthorizedBatch<{
          user?: { dropCampaign?: Record<string, unknown> };
        }>(chunk.map((id) => buildCampaignDetailsQuery(id, request.channelLogin)));
        let hasValidDetail = false;
        results.forEach((result) => {
          const campaign = result.data?.user?.dropCampaign;
          if (!campaign || typeof campaign !== 'object') return;
          const id = normalizeText(campaign.id);
          const hasRewardBuckets =
            Array.isArray(campaign.timeBasedDrops) || Array.isArray(campaign.eventBasedDrops);
          if (!id || !hasRewardBuckets) return;
          hasValidDetail = true;
          fetchedDetails.set(id, campaign);
          request.cache.set(id, campaign);
        });
        if (!hasValidDetail) failedBatches += 1;
      } catch (error) {
        if (isLikelyAuthError(error)) throw error;
        failedBatches += 1;
        logWarn(
          '[TwitchApiClient] Campaign detail batch fetch failed; retaining valid partial data:',
          error instanceof Error ? error.message : String(error),
        );
      }
      if (request.onProgress) {
        await request.onProgress(buildDetailsMap(campaignIds, fetchedDetails, request.cache), failedBatches);
      }
    }
  };
  const workerCount = Math.min(CAMPAIGN_DETAILS_MAX_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => fetchNextBatch()));
  return { detailsMap: buildDetailsMap(campaignIds, fetchedDetails, request.cache), failedBatches };
}
