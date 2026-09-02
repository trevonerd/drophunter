import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitorView } from '../../src/monitor/App.tsx';
import { createInitialState } from '../../src/shared/utils.ts';
import type { AppState, TwitchDrop, TwitchGame } from '../../src/types/index.ts';

export function createGame(rewardSummary: TwitchGame['rewardSummary'], name = 'Test Game'): TwitchGame {
  return {
    id: 'game-1',
    name,
    imageUrl: '',
    campaignId: 'campaign-1',
    rewardSummary,
  };
}

export function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    requiredMinutes: 60,
    remainingMinutes: 60,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

export function automationActivity(
  id: string,
  at: number,
  message: string,
): AppState['automationActivity'][number] {
  return { id, kind: 'auto-started', at, message };
}

export function renderMonitor(overrides: Partial<AppState>, contextNow = 1_700_000_000_000): string {
  const state: AppState = { ...createInitialState(), ...overrides };
  return renderToStaticMarkup(
    createElement(MonitorView, {
      state,
      lastUpdatedAt: 1_700_000_000_000,
      recoveryNow: 1_700_000_000_000,
      contextNow,
    }),
  );
}
