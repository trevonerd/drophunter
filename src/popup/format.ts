import { assertNever } from '../shared/messages';
import { formatFarmingCompleteStatusLine } from '../shared/runtime-status';
import type { CampaignCompletion, CampaignRemainderReason, TwitchGame } from '../types';

export type CampaignIndicatorKind =
  | 'all-acquired'
  | 'subscription-required'
  | 'unverifiable-twitch'
  | 'disconnected';

export type CampaignStatusLine = {
  readonly reason: CampaignRemainderReason | 'farming-complete' | 'disconnected';
  readonly text: string;
};

function campaignCompletion(game: TwitchGame): CampaignCompletion {
  return game.rewardSummary?.completion ?? (game.allDropsCompleted === true ? 'all-acquired' : 'farmable');
}

export function isCampaignFarmable(game: TwitchGame): boolean {
  return campaignCompletion(game) === 'farmable';
}

function isCampaignFarmingComplete(game: TwitchGame): boolean {
  return campaignCompletion(game) === 'farming-complete';
}

function campaignRemainderStatusLine(reason: CampaignRemainderReason): CampaignStatusLine {
  return { reason, text: formatFarmingCompleteStatusLine(reason) };
}

export function getCampaignStatusLines(game: TwitchGame): readonly CampaignStatusLine[] {
  const statusLines: CampaignStatusLine[] = [];
  if (isCampaignFarmingComplete(game)) {
    const reasons = game.rewardSummary?.remainderReasons ?? [];
    if (reasons.includes('subscription-required')) {
      statusLines.push(campaignRemainderStatusLine('subscription-required'));
    }
    if (reasons.includes('unverifiable-twitch')) {
      statusLines.push(campaignRemainderStatusLine('unverifiable-twitch'));
    }
    if (statusLines.length === 0) {
      statusLines.push({ reason: 'farming-complete', text: 'No farmable rewards remain in this campaign.' });
    }
  }
  if (game.isConnected === false) {
    statusLines.push({
      reason: 'disconnected',
      text: `${game.name} account not linked. Link it in campaign details.`,
    });
  }
  return statusLines;
}

export function formatFarmingCompleteQueueMessage(game: TwitchGame): string {
  const statusLines = getCampaignStatusLines(game);
  return statusLines.length > 0
    ? statusLines.map((line) => line.text).join(' ')
    : 'No farmable rewards remain in this campaign.';
}

export function getCampaignIndicatorKinds(game: TwitchGame): readonly CampaignIndicatorKind[] {
  const indicators: CampaignIndicatorKind[] = [];
  const completion = campaignCompletion(game);

  switch (completion) {
    case 'all-acquired':
      indicators.push('all-acquired');
      break;
    case 'farming-complete':
      if (game.rewardSummary?.remainderReasons.includes('subscription-required')) {
        indicators.push('subscription-required');
      }
      if (game.rewardSummary?.remainderReasons.includes('unverifiable-twitch')) {
        indicators.push('unverifiable-twitch');
      }
      break;
    case 'farmable':
      break;
    default:
      return assertNever(completion);
  }

  if (game.isConnected === false) {
    indicators.push('disconnected');
  }
  return indicators;
}

export function rewardInitials(name: string): string {
  const tokens = name
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return '?';
  }
  return tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatClaimedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
