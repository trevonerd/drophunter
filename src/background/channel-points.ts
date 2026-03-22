import type { AppState } from '../types/index.ts';

export interface ChannelPointsBonusClaimResponse {
  success?: boolean;
  claimed?: boolean;
  reason?: 'claimed' | 'not-available' | 'not-supported-page';
}

export function applyAutoClaimChannelPointsBonusSetting(
  state: AppState,
  enabled: boolean | undefined,
): AppState {
  return {
    ...state,
    autoClaimChannelPointsBonus: enabled === true,
  };
}

export function shouldAttemptAutoClaimChannelPointsBonus(state: AppState): boolean {
  return state.isRunning && !state.isPaused && state.autoClaimChannelPointsBonus && state.tabId != null;
}
