// Extracted from src/popup/App.tsx (presentation formatting helpers).
import { getGameDisplayLabel, isSameGameIdentity } from '../shared/game-selection';
import {
  formatEtaMinutes,
  formatFarmingCompleteStatusLine,
  formatRecoveryAttemptLabel,
  formatRecoveryReason,
  formatRetryLabel,
} from '../shared/runtime-status';

export { formatEtaMinutes };

import type { CampaignCompletion, CampaignRemainderReason, ExpiryStatus, TwitchGame } from '../types';

export type CampaignIndicatorKind =
  | 'all-acquired'
  | 'subscription-required'
  | 'unverifiable-twitch'
  | 'disconnected';

export type CampaignStatusLine = {
  readonly reason: CampaignRemainderReason | 'farming-complete' | 'disconnected';
  readonly text: string;
};

function assertNever(value: never): never {
  throw new TypeError(`Unhandled campaign indicator: ${String(value)}`);
}

function campaignCompletion(game: TwitchGame): CampaignCompletion {
  return game.rewardSummary?.completion ?? (game.allDropsCompleted === true ? 'all-acquired' : 'farmable');
}

export function isCampaignFarmable(game: TwitchGame): boolean {
  return campaignCompletion(game) === 'farmable';
}

export function isCampaignFarmingComplete(game: TwitchGame): boolean {
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
      text: 'Connect your game account on Twitch to unlock this campaign.',
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

function campaignIndicatorGlyph(indicator: CampaignIndicatorKind): string {
  switch (indicator) {
    case 'all-acquired':
      return '\u2705';
    case 'subscription-required':
      return '\u{1F4B3}';
    case 'unverifiable-twitch':
      return '\u2754';
    case 'disconnected':
      return '\u{1F512}';
    default:
      return assertNever(indicator);
  }
}

export function formatCampaignOptionLabel(game: TwitchGame, queuedGames: readonly TwitchGame[] = []): string {
  const prefixes = getCampaignIndicatorKinds(game).map(campaignIndicatorGlyph);
  if (queuedGames.some((queuedGame) => isSameGameIdentity(queuedGame, game))) {
    prefixes.unshift('\u2637');
  }
  const prefix = prefixes.join(' ');
  const label = `${getGameDisplayLabel(game)} · ${expiryLabel(game.expiryStatus)}`;
  return prefix ? `${prefix} ${label}` : label;
}

export function formatLastUpdated(timestamp?: number): string {
  if (!timestamp) {
    return 'Waiting for first sync';
  }
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) {
    return 'Updated just now';
  }
  const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60_000));
  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Updated ${elapsedHours}h ago`;
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  return `Updated ${elapsedDays}d ago`;
}

export function expiryLabel(status?: ExpiryStatus) {
  switch (status) {
    case 'urgent':
      return 'Expiry: < 24h';
    case 'warning':
      return 'Expiry: < 72h';
    case 'safe':
      return 'Expiry: not soon';
    default:
      return 'Expiry: unknown';
  }
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

export function statusReasonLabel(reason: string | null | undefined): string | null {
  return formatRecoveryReason(reason);
}

export function retryLabel(timestamp: number | null | undefined, now: number): string | null {
  return formatRetryLabel(timestamp, now);
}

export function recoveryAttemptLabel(
  reason: string | null | undefined,
  attempts: number | null | undefined,
): string | null {
  return formatRecoveryAttemptLabel(reason, attempts);
}
