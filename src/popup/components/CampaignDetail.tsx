import { gameKey, getGameDisplayLabel } from '../../shared/game-selection.ts';
import { isRewardWatchable } from '../../shared/reward-semantics.ts';
import type { TwitchDrop, TwitchGame } from '../../types';
import {
  type CampaignProgressLookup,
  dropsForCampaign,
  formatCampaignEnd,
  isCampaignFarmingComplete,
  isCampaignQueueEligible,
  isCampaignWatchTimeComplete,
  isSubscriptionOnlyCampaign,
  resolveCampaignProgress,
} from './campaign-list-model';
import { CompactDropCard } from './DropCard';
import { CheckIcon } from './icons';

interface CampaignDetailProps {
  readonly game: TwitchGame;
  readonly allDrops: readonly TwitchDrop[];
  readonly queueGames: readonly TwitchGame[];
  readonly loadedCampaignKeys: ReadonlySet<string>;
  readonly refreshDelayed?: boolean;
  readonly progressByCampaignKey?: CampaignProgressLookup;
  readonly highlightedCampaignKey: string | null;
  readonly actionLoading: boolean;
  readonly now: number;
  readonly running?: boolean;
  readonly hidden?: boolean;
  readonly onAddToQueue?: (game: TwitchGame) => void;
  readonly onRemoveFromQueue?: (game: TwitchGame) => void;
  readonly onLinkAccount?: (game: TwitchGame) => void;
}

const TWITCH_CONNECTIONS_URL = 'https://www.twitch.tv/settings/connections';

export function accountLinkFor(game: TwitchGame): string {
  if (!game.accountLinkUrl) return TWITCH_CONNECTIONS_URL;
  try {
    const parsed = new URL(game.accountLinkUrl);
    const hostname = parsed.hostname.toLocaleLowerCase();
    const isTwitchHost = hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv');
    return parsed.protocol === 'https:' && !isTwitchHost ? parsed.href : TWITCH_CONNECTIONS_URL;
  } catch {
    return TWITCH_CONNECTIONS_URL;
  }
}

export function CampaignDetail(props: CampaignDetailProps) {
  const key = gameKey(props.game);
  const label = getGameDisplayLabel(props.game);
  const rewards = dropsForCampaign(props.allDrops, props.game);
  const summary = resolveCampaignProgress(props.progressByCampaignKey, props.game);
  const queued = props.queueGames.some((queuedGame) => gameKey(queuedGame) === key);
  const loaded = props.loadedCampaignKeys.has(key) || rewards.length > 0;
  const completed = isCampaignFarmingComplete(props.game);
  const claimedCount = rewards.filter((drop) => drop.claimed).length;
  const subscriptionCount = rewards.filter((drop) => drop.acquisitionMethod === 'subscription').length;
  const nextRewardName = summary?.nextRewardName?.trim() || rewards.find(isRewardWatchable)?.name;
  const accountLinkUrl = accountLinkFor(props.game);
  const subscriptionOnly = isSubscriptionOnlyCampaign(props.game, props.allDrops, loaded);
  const queueEligible = isCampaignQueueEligible(props.game, props.allDrops, loaded);
  const watchTimeComplete = isCampaignWatchTimeComplete(props.game, props.allDrops);

  return (
    <article
      tabIndex={-1}
      aria-label={label}
      data-campaign-key={key}
      data-highlighted={props.highlightedCampaignKey === key ? 'true' : 'false'}
      data-running={props.running ? 'true' : 'false'}
      data-subscription-only={subscriptionOnly ? 'true' : 'false'}
      className={`min-w-0 border-t border-[color:var(--dh-border)] px-2 py-2 first:border-t-0 ${
        props.highlightedCampaignKey === key ? 'ring-1 ring-[color:var(--dh-accent)]' : ''
      } ${props.running ? 'dh-campaign--running' : ''} ${subscriptionOnly ? 'dh-campaign--subscription-only' : ''}`}
    >
      <div className="dh-campaign-card-header flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[11px] font-semibold leading-snug text-[color:var(--dh-text)]">
              {props.game.campaignName?.trim() || 'Campaign rewards'}
            </span>
            {(completed || watchTimeComplete) && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-green-500/15 px-1 py-px text-[9px] font-semibold text-green-300">
                <CheckIcon /> {completed ? 'Completed' : 'Watch time complete'} · 100%
              </span>
            )}
            {props.running && <span className="dh-running-badge">Running</span>}
          </div>
          {!completed && (
            <p className="mt-0.5 truncate text-[10px] text-[color:var(--dh-muted)]">
              {formatCampaignEnd(props.game, props.now)}
              {nextRewardName ? ` · Next: ${nextRewardName}` : ''}
            </p>
          )}
        </div>
        {!completed && (
          <div className="dh-campaign-card-actions flex shrink-0 items-center gap-1">
            {props.game.isConnected === false && accountLinkUrl && (
              <a
                href={accountLinkUrl}
                target="_blank"
                rel="noreferrer"
                className="dh-action-secondary dh-focus rounded-md px-2 py-1 text-[10px] font-semibold"
                aria-label={`Link ${label} account`}
                onClick={() => props.onLinkAccount?.(props.game)}
              >
                Link account
              </a>
            )}
            {!props.hidden && (queued || !watchTimeComplete) && (
              <span
                title={subscriptionOnly ? 'This campaign only contains subscription rewards.' : undefined}
                className="inline-flex"
              >
                <button
                  type="button"
                  className="dh-action-secondary dh-focus rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-55"
                  onClick={() =>
                    queued ? props.onRemoveFromQueue?.(props.game) : props.onAddToQueue?.(props.game)
                  }
                  disabled={
                    props.actionLoading ||
                    (queued ? !props.onRemoveFromQueue : !props.onAddToQueue || !queueEligible)
                  }
                  aria-label={`${queued ? 'Remove' : 'Add'} ${label} ${queued ? 'from' : 'to'} queue`}
                >
                  {queued ? 'Remove' : 'Add'}
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      {!completed && watchTimeComplete && rewards.some((drop) => !drop.claimed && drop.claimable) && (
        <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]" role="status" aria-live="polite">
          {props.game.isConnected === false
            ? 'Watch time complete · Link account to claim.'
            : 'Watch time complete · Awaiting claim.'}
        </p>
      )}
      {!completed && !loaded && (
        <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]" role="status">
          {props.refreshDelayed ? 'Still loading Drops — retrying…' : 'Loading Drops…'}
        </p>
      )}
      {!completed && loaded && rewards.length === 0 && (
        <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]">No Drops found.</p>
      )}
      {!completed && loaded && rewards.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-[color:var(--dh-text-soft)]">
            {rewards.length} {rewards.length === 1 ? 'Drop' : 'Drops'} · {claimedCount} claimed
            {subscriptionCount > 0 ? ` · ${subscriptionCount} subscription` : ''}
          </p>
          {(typeof summary?.progress === 'number' || typeof summary?.eligibleStreamerCount === 'number') && (
            <p className="mt-0.5 text-[10px] text-[color:var(--dh-muted)]">
              {typeof summary.progress === 'number'
                ? `${summary.progress}% progress`
                : 'Progress unavailable'}
              {typeof summary.eligibleStreamerCount === 'number'
                ? ` · ${summary.eligibleStreamerCount} eligible live ${summary.eligibleStreamerCount === 1 ? 'channel' : 'channels'}`
                : ''}
            </p>
          )}
          <div className="mt-1 divide-y divide-[color:var(--dh-border)] border-t border-[color:var(--dh-border)]">
            {rewards.map((drop) => (
              <CompactDropCard
                key={`${drop.campaignId ?? props.game.campaignId}:${drop.id}`}
                drop={drop}
                running={props.running && !drop.claimed}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
