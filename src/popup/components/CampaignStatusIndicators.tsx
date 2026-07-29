import type { TwitchGame } from '../../types';
import { getCampaignIndicatorKinds } from '../format';
import { QuestionIcon, SubIcon } from './icons';

export type CampaignStatusIndicatorsProps = {
  readonly game: TwitchGame;
};

export function CampaignStatusIndicators({ game }: CampaignStatusIndicatorsProps) {
  const indicators = getCampaignIndicatorKinds(game);
  const isAllAcquired = indicators.includes('all-acquired');
  const hasSubscriptionRemainder = indicators.includes('subscription-required');
  const hasUnverifiableRemainder = indicators.includes('unverifiable-twitch');
  const isDisconnected = indicators.includes('disconnected');

  if (indicators.length === 0) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {isAllAcquired && (
        <span
          role="img"
          data-campaign-indicator="all-acquired"
          className="font-bold text-green-400"
          aria-label="All campaign rewards acquired"
          title="All campaign rewards acquired"
        >
          ✓
        </span>
      )}
      {hasSubscriptionRemainder && (
        <span
          role="img"
          data-campaign-indicator="subscription-required"
          className="inline-flex text-orange-400"
          aria-label="Subscription required for remaining rewards"
          title="Subscription required for remaining rewards"
        >
          <SubIcon />
        </span>
      )}
      {hasUnverifiableRemainder && (
        <span
          role="img"
          data-campaign-indicator="unverifiable-twitch"
          className="inline-flex text-orange-400"
          aria-label="Twitch reward acquisition could not be verified"
          title="Twitch reward acquisition could not be verified"
        >
          <QuestionIcon />
        </span>
      )}
      {isDisconnected && (
        <span
          role="img"
          data-campaign-indicator="disconnected"
          aria-label="Twitch account disconnected"
          title="Twitch account disconnected"
        >
          🔒
        </span>
      )}
    </span>
  );
}
