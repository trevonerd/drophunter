// Extracted from src/popup/App.tsx (presentation formatting helpers).
import { formatRecoveryAttemptLabel, formatRecoveryReason, formatRetryLabel } from '../shared/runtime-status';
import type { ExpiryStatus } from '../types';

export function formatLastUpdated(timestamp?: number): string {
  if (!timestamp) {
    return 'Never updated';
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

export function formatEtaMinutes(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const minutes = Math.max(0, Math.round(value));
  if (minutes <= 0) {
    return '< 1m';
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) {
    return `${rem}m`;
  }
  if (rem === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${rem}m`;
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
