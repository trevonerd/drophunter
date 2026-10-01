import type { AppState, ClaimLogEntry } from '../types/index.ts';
export const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
export interface BackupFile {
  format: 'drophunter-backup';
  formatVersion: number;
  extensionVersion: string;
  exportedAt: string;
  sections: Record<string, { version: number; data: unknown }>;
}
export interface BackupInspection {
  file: BackupFile | null;
  extensionVersion: string;
  exportedAt: string;
  compatibility: 'compatible' | 'migrated' | 'partial' | 'incompatible';
  error?: string;
  sections: { id: string; label: string; compatible: boolean; reason?: string; unknownFields?: string[] }[];
}
export interface BackupImportOptions {
  mode: 'merge' | 'replace';
  settings: 'local' | 'backup';
  sections: string[];
}
export interface BackupSummary {
  warnings: string[];
  favorites: number;
  hiddenGames: number;
  claimLog: number;
  totalDropsClaimed: number;
  totalChannelPointsClaimed: number;
  reactivationRequired: boolean;
}
export interface BackupApplyContext {
  warnings: string[];
  appState: AppState;
  localState: AppState;
  claimLog: ClaimLogEntry[];
  options: BackupImportOptions;
  historyCount: number;
  reactivationRequired: boolean;
}
export interface BackupSectionBehavior {
  order: number;
  missingFieldPolicy: 'preserve-current';
  sensitive: false;
  export: (state: AppState, history: ClaimLogEntry[]) => unknown;
  merge: (context: BackupApplyContext, data: unknown) => void;
  replace: (context: BackupApplyContext, data: unknown) => void;
  preview: (context: BackupApplyContext) => number | string;
}
