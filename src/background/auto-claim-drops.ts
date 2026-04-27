import type { AppState } from '../types/index.ts';

export function applyAutoClaimDropsSetting(state: AppState, enabled: boolean | undefined): AppState {
  return {
    ...state,
    autoClaimDrops: enabled === true,
  };
}

export function shouldAttemptAutoClaimDrops(state: AppState): boolean {
  return state.isRunning && !state.isPaused && state.autoClaimDrops;
}
