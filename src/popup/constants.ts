// Extracted from src/popup/App.tsx (top-level constants and CampaignSyncStatus type).
import type { StreamerSelectionMode } from '../types';

export const STREAMER_SELECTION_OPTIONS: Array<{ value: StreamerSelectionMode; label: string }> = [
  { value: 'low-view', label: 'Low view' },
  { value: 'random', label: 'Random' },
  { value: 'top-viewers', label: 'Top viewers' },
];

export const NOTIFICATION_PERMISSION: chrome.permissions.Permissions = { permissions: ['notifications'] };

export const TELEGRAM_HOST_PERMISSION: chrome.permissions.Permissions = {
  origins: ['https://api.telegram.org/*'],
};

export const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export const STREAMER_LANGUAGE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'ar', label: 'AR' },
  { value: 'bg', label: 'BG' },
  { value: 'cs', label: 'CS' },
  { value: 'da', label: 'DA' },
  { value: 'de', label: 'DE' },
  { value: 'el', label: 'EL' },
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
  { value: 'fi', label: 'FI' },
  { value: 'fr', label: 'FR' },
  { value: 'he', label: 'HE' },
  { value: 'hi', label: 'HI' },
  { value: 'hu', label: 'HU' },
  { value: 'id', label: 'ID' },
  { value: 'it', label: 'IT' },
  { value: 'ja', label: 'JA' },
  { value: 'ko', label: 'KO' },
  { value: 'ms', label: 'MS' },
  { value: 'nl', label: 'NL' },
  { value: 'no', label: 'NO' },
  { value: 'pl', label: 'PL' },
  { value: 'pt', label: 'PT' },
  { value: 'ro', label: 'RO' },
  { value: 'ru', label: 'RU' },
  { value: 'sk', label: 'SK' },
  { value: 'sv', label: 'SV' },
  { value: 'th', label: 'TH' },
  { value: 'tl', label: 'TL' },
  { value: 'tr', label: 'TR' },
  { value: 'vi', label: 'VI' },
  { value: 'zh', label: 'ZH' },
  { value: 'zh_hk', label: 'ZH-HK' },
];

export type CampaignSyncStatus = 'empty' | 'signed-out' | 'fresh' | 'stale' | 'syncing' | 'failed';

export interface CampaignSyncStatusInput {
  dropsRefreshLoading: boolean;
  activeSyncError: string | null;
  gamesLoading: boolean;
  availableCampaignCount: number;
  twitchSessionDetected: boolean;
  isStale: boolean;
}

export function deriveCampaignSyncStatus({
  dropsRefreshLoading,
  activeSyncError,
  gamesLoading,
  availableCampaignCount,
  twitchSessionDetected,
  isStale,
}: CampaignSyncStatusInput): CampaignSyncStatus {
  if (!gamesLoading && !twitchSessionDetected) return 'signed-out';
  if (dropsRefreshLoading) return 'syncing';
  if (activeSyncError) return 'failed';
  if (!gamesLoading && availableCampaignCount === 0) return 'empty';
  if (isStale) return 'syncing';
  return 'fresh';
}
