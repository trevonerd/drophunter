import type { DropsPageRefreshOptions, DropsPageState } from './drops-page-tab-lifecycle.ts';
import type { TwitchApiFailure } from './twitch-api/errors.ts';

const DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS = 10_000;
const DEFAULT_CAMPAIGN_REFRESH_ATTEMPTS = 3;
const DEFAULT_CAMPAIGN_REFRESH_RETRY_DELAY_MS = 500;

export type CampaignRefreshResult = {
  readonly gamesCount: number;
  readonly sawSession: boolean;
  readonly snapshotAvailable: boolean;
  readonly inventoryVerified: boolean;
  readonly failure?: TwitchApiFailure;
};

interface CampaignRefreshInput {
  readonly isCurrent: () => boolean;
  readonly publishRefreshState: (inProgress: boolean, state: CampaignRefreshState) => Promise<void>;
  readonly startedAt: number;
  readonly state: DropsPageState;
  readonly tabId: number;
  readonly options: DropsPageRefreshOptions;
}

type CampaignRefreshState = {
  readonly completedAt?: number | null;
  readonly campaignCount?: number | null;
  readonly error?: string | null;
};

export async function refreshDropsPageCampaigns(input: CampaignRefreshInput): Promise<CampaignRefreshResult> {
  const attempts = Math.max(
    1,
    Math.floor(input.options.campaignRefreshAttempts ?? DEFAULT_CAMPAIGN_REFRESH_ATTEMPTS),
  );
  const retryDelayMs = Math.max(
    0,
    input.options.campaignRefreshRetryDelayMs ?? DEFAULT_CAMPAIGN_REFRESH_RETRY_DELAY_MS,
  );
  const readyTimeoutMs = Math.max(
    1,
    input.options.dropsPageReadyTimeoutMs ?? DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS,
  );
  const deadline = input.startedAt + readyTimeoutMs;
  let sawSession = false;
  let gamesCount = 0;
  let snapshotAvailable = false;
  let inventoryVerified = false;
  let failure: TwitchApiFailure | undefined;
  let initialSnapshotPublished = false;

  const publishInitialSnapshot = async () => {
    if (!input.isCurrent() || initialSnapshotPublished) return;
    initialSnapshotPublished = true;
    gamesCount = input.state.appState.availableGames.length;
    snapshotAvailable = true;
    await input.publishRefreshState(false, {
      completedAt: Date.now(),
      campaignCount: gamesCount,
      error: null,
    });
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!input.isCurrent()) break;
    const isFinalAttemptByCount = attempt === attempts;
    const isFinalAttemptByTime = Date.now() >= deadline;
    const sessionFromTab = await input.options.persistSessionFromDropsPage(input.tabId);
    if (!input.isCurrent()) break;
    sawSession = sawSession || Boolean(sessionFromTab);
    const refreshResult = await input.options.refreshGamesCacheFromHiddenFetch({
      // A missed page read is not evidence that the cached OAuth session is invalid.
      // The normal session resolver still checks cache, persisted state, and open tabs.
      forceSessionRefresh: false,
      acceptAuthoritativeEmpty: isFinalAttemptByCount || isFinalAttemptByTime,
      requireFreshSnapshot: true,
      isCurrent: input.isCurrent,
      onProgressiveSnapshotApplied: publishInitialSnapshot,
    });
    if (!input.isCurrent()) break;
    gamesCount =
      refreshResult.kind === 'refreshed'
        ? refreshResult.games.length
        : input.state.appState.availableGames.length;
    failure = refreshResult.kind === 'unavailable' ? refreshResult.failure : undefined;
    if (
      refreshResult.kind === 'refreshed' &&
      (gamesCount > 0 || isFinalAttemptByCount || isFinalAttemptByTime)
    ) {
      snapshotAvailable = true;
      inventoryVerified =
        refreshResult.inventoryVerified === true &&
        (gamesCount > 0 || refreshResult.authoritativeEmpty === true);
      break;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(retryDelayMs, remainingMs)));
  }

  return { gamesCount, sawSession, snapshotAvailable, inventoryVerified, ...(failure ? { failure } : {}) };
}
