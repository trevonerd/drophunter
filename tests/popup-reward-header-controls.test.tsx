import { expect, test } from 'bun:test';
import type { AppState } from '../src/types';
import { appState, game, renderMainView } from './fixtures/popup-reward';

test('header mute action requires a running DropHunter-owned managed tab', () => {
  const selected = game();
  const headerFor = (overrides: Partial<AppState>) => {
    const markup = renderMainView(
      { ...appState(selected), ...overrides },
      [],
      { runtimeMode: overrides.isRunning ? 'running' : 'idle' },
    );
    return markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
  };

  expect(
    headerFor({ isRunning: true, watchTransportMode: 'managed-tab', tabId: 17, muteFarmingTab: false }),
  ).toContain(
    'aria-label="Mute stream audio"',
  );
  expect(headerFor({ isRunning: true, watchTransportMode: 'tabless', tabId: null })).not.toContain(
    'aria-label="Mute stream audio"',
  );
  expect(headerFor({ isRunning: true, watchTransportMode: 'managed-tab', tabId: null })).not.toContain(
    'aria-label="Mute stream audio"',
  );
  expect(headerFor({ isRunning: false, watchTransportMode: 'managed-tab', tabId: 17 })).not.toContain(
    'aria-label="Mute stream audio"',
  );
});

test('header always exposes direct Twitch Drops access', () => {
  // Given
  const selected = game();

  // When
  const markup = renderMainView(appState(selected));
  const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';

  // Then
  expect(header).toContain('aria-label="Open Twitch Drops"');
  expect(header).toContain('title="Twitch Drops"');
});
