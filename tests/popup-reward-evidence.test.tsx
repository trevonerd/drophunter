import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppState } from '../src/types';
import {
  appState,
  drop,
  game,
  renderMainView,
  startButtonMarkup,
} from './fixtures/popup-reward';

test('evidence states preserve happy, terminal, and long-label popup semantics', () => {
  // Given
  const happyGame = game({ campaignId: 'happy-campaign', campaignName: 'Fresh Badge Campaign' });
  const happyReward = drop({
    id: 'happy-reward',
    name: 'Fresh Twitch Badge',
    rewardKind: 'twitch-badge',
    verificationState: 'unassessed',
    status: 'active',
    requiredMinutes: 60,
    remainingMinutes: 60,
  });
  const happyState = {
    ...appState(happyGame),
    pendingDrops: [happyReward],
  } satisfies AppState;

  const acquiredGame = game({
    campaignId: 'acquired-campaign',
    campaignName: 'Fully Acquired Campaign',
    isConnected: false,
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  });

  const terminalGame = game({
    campaignId: 'terminal-campaign',
    campaignName: 'Mixed Remainder Campaign',
    isConnected: false,
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });
  const subscriptionReward = drop({
    id: 'subscription-reward',
    name: 'Subscriber Crown',
    acquisitionMethod: 'subscription',
  });
  const subscriptionOnlyGame = game({
    campaignId: 'subscription-only-campaign',
    campaignName: 'Subscription Remainder Campaign',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const subscriptionOnlyState = {
    ...appState(subscriptionOnlyGame),
    pendingDrops: [subscriptionReward],
  } satisfies AppState;
  const unverifiableReward = drop({
    id: 'unverifiable-reward',
    name: 'Twitch Emote Reward',
    progress: 99,
    rewardKind: 'twitch-emote',
    verificationState: 'unverifiable',
  });
  const terminalState = {
    ...appState(terminalGame),
    pendingDrops: [subscriptionReward, unverifiableReward],
    lastStopReason: 'unverifiable-twitch',
    lastStopMessage: 'All rewards claimed',
  } satisfies AppState;

  const longCampaignName = `Campaign${'X'.repeat(180)}`;
  const longRewardName = `Reward${'Y'.repeat(180)}`;
  const longGame = game({
    id: 'long-game',
    campaignId: 'long-campaign',
    name: `Game${'Z'.repeat(120)}`,
    campaignName: longCampaignName,
  });
  const longQueueGame = game({
    id: 'long-queue-game',
    campaignId: 'long-queue-campaign',
    name: `Queued${'Q'.repeat(120)}`,
    campaignName: `Queue${'W'.repeat(140)}`,
  });
  const longState = {
    ...appState(longGame),
    availableGames: [longGame, longQueueGame],
    pendingDrops: [drop({ id: 'long-reward', name: longRewardName, status: 'active' })],
  } satisfies AppState;

  // When
  const happyMarkup = renderMainView(happyState);
  const acquiredMarkup = renderMainView(appState(acquiredGame));
  const subscriptionOnlyMarkup = renderMainView(subscriptionOnlyState);
  const terminalMarkup = renderMainView(terminalState, [], { runtimeMode: 'stopped-terminal' });
  const longMarkup = renderMainView(longState, [longQueueGame]);

  // Then
  expect(happyMarkup).toContain('Fresh Twitch Badge');
  expect(startButtonMarkup(happyMarkup)).not.toContain(' disabled=');
  expect(acquiredMarkup).toContain('data-campaign-indicator="all-acquired"');
  expect(acquiredMarkup).toContain('data-campaign-indicator="disconnected"');
  expect(acquiredMarkup).not.toContain('data-campaign-indicator="subscription-required"');
  expect(acquiredMarkup).not.toContain('data-campaign-indicator="unverifiable-twitch"');
  expect(subscriptionOnlyMarkup).toContain('data-subscription-icon="payment-card"');
  expect(subscriptionOnlyMarkup).toContain(
    'All farmable rewards claimed · Subscription required for remaining rewards',
  );
  expect(terminalMarkup).toContain('data-campaign-status-reason="subscription-required"');
  expect(terminalMarkup).toContain('data-campaign-status-reason="unverifiable-twitch"');
  expect(terminalMarkup).not.toContain('All rewards claimed');
  expect(terminalMarkup).toContain('[overflow-wrap:anywhere]');
  expect(longMarkup).toContain(longCampaignName);
  expect(longMarkup).toContain(longRewardName);
  expect(longMarkup).toContain('min-w-0 truncate');

  const evidencePath = process.env.TASK13_EVIDENCE_HTML;
  if (!evidencePath) {
    return;
  }

  const assetsDirectory = join(process.cwd(), '.output/chrome-mv3/assets');
  const popupStylesheet = readdirSync(assetsDirectory).find(
    (filename) => filename.startsWith('popup-') && filename.endsWith('.css'),
  );
  if (!popupStylesheet) {
    throw new Error('Built popup stylesheet was not found. Run bun run build:chrome first.');
  }
  const popupCss = readFileSync(join(assetsDirectory, popupStylesheet), 'utf8');
  const frame = (label: string, markup: string) =>
    `<section class="evidence-case"><h2 class="evidence-title">${label}</h2><div class="dh-view w-[400px] text-[color:var(--dh-text)] outline-none">${markup}</div></section>`;
  const evidenceDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=420, initial-scale=1">
  <title>Task 13 popup reward semantics</title>
  <style>${popupCss}
    html, body { width: 420px; min-width: 420px; margin: 0; overflow-x: hidden; background: #0e0e10; }
    body { color: #efeff1; }
    .evidence-case { width: 420px; padding: 10px; border-bottom: 1px solid #303036; }
    .evidence-title { width: 400px; margin: 0 0 8px; color: #bf94ff; font: 700 12px/1.4 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; }
  </style>
</head>
<body>
  ${frame('Happy · fresh 0% Twitch-native reward', happyMarkup)}
  ${frame('Acquired · exclusive green check with independent lock', acquiredMarkup)}
  ${frame('Terminal · subscription-only remainder', subscriptionOnlyMarkup)}
  ${frame('Terminal · mixed non-automatable remainder', terminalMarkup)}
  ${frame('Stress · long unbroken campaign and reward labels', longMarkup)}
  <script>
    window.addEventListener('error', () => { document.documentElement.dataset.runtimeErrors = '1'; });
    window.addEventListener('unhandledrejection', () => { document.documentElement.dataset.runtimeErrors = '1'; });
    requestAnimationFrame(() => {
      const popupFrames = Array.from(document.querySelectorAll('.dh-view'));
      document.documentElement.dataset.runtimeErrors ??= '0';
      document.documentElement.dataset.viewportWidth = String(window.innerWidth);
      document.documentElement.dataset.scrollWidth = String(document.documentElement.scrollWidth);
      document.documentElement.dataset.scrollHeight = String(document.documentElement.scrollHeight);
      document.documentElement.dataset.bodyScrollWidth = String(document.body.scrollWidth);
      document.documentElement.dataset.bodyScrollHeight = String(document.body.scrollHeight);
      document.documentElement.dataset.popupWidths = popupFrames
        .map((frame) => String(frame.clientWidth) + '/' + String(frame.scrollWidth))
        .join(',');
      document.documentElement.dataset.popupOverflow = String(
        popupFrames.some((frame) => frame.scrollWidth > frame.clientWidth),
      );
    });
  </script>
</body>
</html>`;
  writeFileSync(evidencePath, evidenceDocument, 'utf8');
});
