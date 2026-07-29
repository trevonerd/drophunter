import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applyUnverifiableRewardMarker,
  markDropUnverifiable,
} from '../src/background/drops-projection-semantics';
import { createServiceWorkerState } from '../src/background/runtime-state';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
  buildInventoryDropMaps,
  parseCampaignDrops,
} from '../src/background/twitch-api/client';
import { isRewardAutomatable } from '../src/shared/reward-semantics';
import { CampaignStatusIndicators } from '../src/popup/components/CampaignStatusIndicators';
import { CompactDropCard } from '../src/popup/components/DropCard';
import { MainView, type MainViewProps } from '../src/popup/components/MainView';
import { QueueChips } from '../src/popup/components/QueueChips';
import { RewardList } from '../src/popup/components/RewardList';
import { formatFarmingCompleteQueueMessage } from '../src/popup/format';
import type { AppState, TwitchDrop, TwitchGame } from '../src/types';

function game(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-id',
    name: 'Example Game',
    imageUrl: '',
    campaignId: 'campaign-id',
    campaignName: 'Example Campaign',
    isConnected: true,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
    ...overrides,
  };
}

function appState(selectedGame: TwitchGame | null): AppState {
  return {
    selectedGame,
    isRunning: false,
    isPaused: false,
    monitorAutoOpen: false,
    autoResumeOnStartup: false,
    muteFarmingTab: true,
    notificationsEnabled: false,
    telegramAlertsEnabled: false,
    autoClaimChannelPointsBonus: false,
    autoClaimDrops: false,
    totalDropsClaimed: 0,
    totalChannelPointsClaimed: 0,
    streamerSelectionMode: 'low-view',
    preferredStreamerLanguage: null,
    activeStreamer: null,
    currentDrop: null,
    completedDrops: [],
    pendingDrops: [],
    allDrops: [],
    availableGames: selectedGame ? [selectedGame] : [],
    queue: [],
    monitorWindowId: null,
    tabId: null,
    completionNotified: false,
    twitchSessionDetected: true,
    dropsPageRefreshInProgress: false,
  };
}

function drop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-id',
    name: 'Example Reward',
    gameId: 'game-id',
    gameName: 'Example Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    claimable: false,
    status: 'pending',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

function renderMainView(
  state: AppState,
  queueGames: TwitchGame[] = [],
  overrides: Partial<MainViewProps> = {},
): string {
  const props = {
    state,
    actionLoading: false,
    dropsRefreshLoading: false,
    campaignSyncStatus: 'fresh',
    activeSyncError: null,
    sortedGames: state.availableGames,
    queueGames,
    pendingDrops: state.pendingDrops,
    completedDrops: state.completedDrops,
    claimableCount: 0,
    runtimeMode: 'idle',
    recoveryNow: 0,
    onboardingStep: null,
    firstSyncConfirmation: false,
    firstSyncCampaignCount: null,
    queueMessage: null,
    rewardsLoading: false,
    onMuteToggle: () => {},
    onOpenDropsPage: () => {},
    onOpenMonitor: () => {},
    onOpenSettings: () => {},
    onNotificationsToggle: () => {},
    onPause: () => {},
    onResume: () => {},
    onStop: () => {},
    onRefreshCampaigns: () => {},
    onSelectGame: () => {},
    onAddToQueue: () => {},
    onRemoveFromQueue: () => {},
    onClearQueue: () => {},
    onReorderQueue: () => {},
    onStart: () => {},
    ...overrides,
  } satisfies MainViewProps;

  return renderToStaticMarkup(<MainView {...props} />);
}

function startButtonMarkup(markup: string): string {
  return markup.match(/<button[^>]*>Start (?:Farming|Queue \(\d+\))<\/button>/)?.[0] ?? '';
}

test('all-acquired stays exclusive while disconnected account status remains independent', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    allDropsCompleted: true,
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('data-campaign-indicator="all-acquired"');
  expect(markup).toContain('data-campaign-indicator="disconnected"');
  expect(markup).not.toContain('data-campaign-indicator="subscription-required"');
  expect(markup).not.toContain('data-campaign-indicator="unverifiable-twitch"');
});

test('selected disconnected campaign explains why it is locked', () => {
  // Given
  const selectedGame = game({ isConnected: false });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('data-campaign-indicator="disconnected"');
  expect(markup).toContain('data-campaign-status-reason="disconnected"');
  expect(markup).toContain('Connect your game account on Twitch to unlock this campaign.');
});

test('subscription-required renders the payment-card indicator independently', () => {
  // Given
  const campaign = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);

  // Then
  expect(markup).toContain('data-campaign-indicator="subscription-required"');
  expect(markup).toContain('data-subscription-icon="payment-card"');
  expect(markup).toContain('<rect x="3" y="5" width="18" height="14" rx="2"');
  expect(markup).not.toContain('data-campaign-indicator="unverifiable-twitch"');
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('unverifiable-twitch renders the circled-question indicator independently', () => {
  // Given
  const campaign = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);

  // Then
  expect(markup).toContain('data-campaign-indicator="unverifiable-twitch"');
  expect(markup).not.toContain('data-campaign-indicator="subscription-required"');
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('combined farming-complete indicators stay payment then question with no green check', () => {
  // Given
  const campaign = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch', 'subscription-required'],
    },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);
  const subscriptionIndex = markup.indexOf('data-campaign-indicator="subscription-required"');
  const questionIndex = markup.indexOf('data-campaign-indicator="unverifiable-twitch"');

  // Then
  expect(subscriptionIndex).toBeGreaterThan(-1);
  expect(questionIndex).toBeGreaterThan(subscriptionIndex);
  expect(markup.match(/data-campaign-indicator=/g)).toHaveLength(2);
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('native option label keeps campaign identity and compact ordered status prefixes', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch', 'subscription-required'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('💳 ❔ 🔒 Example Game · Example Campaign · Expiry: unknown');
  expect(markup).not.toContain('✅ Example Game · Example Campaign');
});

test('selected subscription status aligns its cost icon beside wrapped copy', () => {
  // Given
  const selectedGame = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('class="flex min-w-0 items-start gap-1.5 text-[11px]"');
  expect(markup).toContain('class="inline-flex min-h-[1lh] shrink-0 items-center gap-1"');
  expect(markup).toContain('class="min-w-0 flex-1 space-y-1"');
  expect(markup.indexOf('data-campaign-indicator="subscription-required"')).toBeLessThan(
    markup.indexOf('data-campaign-status-reason="subscription-required"'),
  );
});

test('native option lock remains independent from the all-acquired prefix', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('✅ 🔒 Example Game · Example Campaign · Expiry: unknown');
});

test('queue chips reuse campaign indicators', () => {
  // Given
  const queuedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={null}
      queueGames={[queuedGame]}
      isRunning={false}
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  // Then
  expect(markup).toContain('data-campaign-indicator="subscription-required"');
  expect(markup).toContain('data-campaign-indicator="unverifiable-twitch"');
});

test('subscription reward card uses the exact redemption copy', () => {
  // Given
  const subscriptionReward = drop({
    acquisitionMethod: 'subscription',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={subscriptionReward} />);

  // Then
  expect(markup).toContain('Subscription required');
  expect(markup).toContain('Subscribe to redeem this reward');
  expect(markup).toContain('class="mt-1 text-[10px] text-orange-400"');
  expect(markup).not.toContain('opacity-60');
  expect(markup).not.toContain('text-orange-400/70');
  expect(markup).not.toContain('Sub only');
});

test('claimed Twitch-native parser observation stays unverifiable after marker projection', () => {
  // Given
  const campaign = {
    id: 'campaign-unverifiable-badge',
    timeBasedDrops: [
      {
        id: 'unverifiable-badge-drop',
        name: 'Twitch Badge Reward',
        requiredMinutesWatched: 60,
        benefitEdges: [
          {
            benefit: {
              id: 'unverifiable-badge-benefit',
              name: 'Twitch Badge Reward',
              distributionType: 'BADGE',
            },
          },
        ],
      },
    ],
  };
  const inventory = {
    dropCampaignsInProgress: [
      {
        id: campaign.id,
        timeBasedDrops: [
          {
            id: 'unverifiable-badge-drop',
            requiredMinutesWatched: 60,
            self: { currentMinutesWatched: 60, isClaimed: true, isClaimable: false },
          },
        ],
      },
    ],
    gameEventDrops: [],
  };
  const parsedRewards = parseCampaignDrops(
    campaign,
    game({ campaignId: campaign.id }),
    buildInventoryDropMaps(inventory),
    buildClaimedRewardLookup(inventory),
    buildGlobalClaimedRewardEntry(inventory),
  );
  const parsedReward = parsedRewards[0];
  if (!parsedReward) {
    throw new TypeError('Expected the Twitch badge parser fixture to produce one reward');
  }
  const state = createServiceWorkerState();
  const markerRecorded = markDropUnverifiable(state, parsedReward, 123_456);
  const unverifiableReward = applyUnverifiableRewardMarker(state, parsedReward);

  expect(markerRecorded).toBe(true);
  expect(unverifiableReward).toMatchObject({
    claimed: true,
    progress: 100,
    remainingMinutes: 0,
    rewardKind: 'twitch-badge',
    verificationState: 'unverifiable',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={unverifiableReward} />);

  // Then
  expect(markup).toContain('Unverifiable');
  expect(markup).toContain('100%');
  expect(markup).toContain('Acquisition could not be verified on Twitch');
  expect(markup).not.toContain('>Claimed<');
});

test('claimed Twitch-native observation without timestamp proof renders as unverifiable', () => {
  const claimedUnassessed = drop({
    claimed: true,
    progress: 100,
    rewardKind: 'twitch-badge',
    verificationState: 'unassessed',
  });

  const markup = renderToStaticMarkup(<CompactDropCard drop={claimedUnassessed} />);

  expect(markup).toContain('Unverifiable');
  expect(markup).not.toContain('>Claimed<');
  expect(markup).not.toContain('ETA');
});

test('verified Twitch-native reward card retains the acquired presentation', () => {
  // Given
  const verifiedReward = drop({
    claimed: true,
    progress: 100,
    status: 'completed',
    rewardKind: 'twitch-badge',
    verificationState: 'verified',
  });

  // When
  const markup = renderToStaticMarkup(<CompactDropCard drop={verifiedReward} />);

  // Then
  expect(markup).toContain('>Claimed<');
  expect(markup).toContain('100%');
  expect(markup).not.toContain('Unverifiable');
});

test('ordinary reward cards retain claimable, active, and pending controls', () => {
  // Given
  const claimableReward = drop({ claimable: true, progress: 100 });
  const activeReward = drop({ status: 'active', progress: 42, remainingMinutes: 18 });
  const pendingReward = drop();

  // When
  const markup = [claimableReward, activeReward, pendingReward]
    .map((reward) => renderToStaticMarkup(<CompactDropCard drop={reward} />))
    .join('\n');

  // Then
  expect(markup).toContain('>Claimable<');
  expect(markup).toContain('dh-progress-fill--claimable');
  expect(markup).toContain('>Active<');
  expect(markup).toContain('42%');
  expect(markup).toContain('ETA 18m');
  expect(markup).toContain('>Pending<');
});

test('claimable count renders only rewards DropHunter can automate', () => {
  // Given
  const watchReward = drop({ id: 'watch', claimable: true });
  const subscriptionReward = drop({
    id: 'subscription',
    claimable: true,
    acquisitionMethod: 'subscription',
  });
  const pendingDrops = [watchReward, subscriptionReward];
  const claimableCount = pendingDrops.filter(
    (reward) => reward.claimable && isRewardAutomatable(reward),
  ).length;

  // When
  const markup = renderToStaticMarkup(
    <RewardList
      pendingDrops={pendingDrops}
      completedDrops={[]}
      rewardsLoading={false}
      syncLoading={false}
      claimableCount={claimableCount}
    />,
  );

  // Then
  expect(markup).toContain('1 claimable');
  expect(markup).not.toContain('2 claimable');
});

test('running status does not present a non-automatable reward as the nearest active reward', () => {
  // Given
  const selectedGame = game();
  const state = {
    ...appState(selectedGame),
    isRunning: true,
    currentDrop: drop({
      name: 'Nearest Unverifiable Reward',
      progress: 99,
      rewardKind: 'twitch-emote',
      verificationState: 'unverifiable',
    }),
  } satisfies AppState;

  // When
  const markup = renderMainView(state);

  // Then
  expect(markup).not.toContain('Nearest Unverifiable Reward 99%');
});

test('fresh zero-percent Twitch-native campaign keeps Start enabled', () => {
  // Given
  const selectedGame = game({
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const state = {
    ...appState(selectedGame),
    pendingDrops: [
      drop({
        name: 'Fresh Twitch Badge',
        progress: 0,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      }),
    ],
  } satisfies AppState;

  // When
  const markup = renderMainView(state);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Farming');
  expect(startButton).not.toContain(' disabled=');
});

test('farming-complete selection disables Start when no farmable queue head exists', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame));
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain(' disabled=');
  expect(markup).toContain('role="status" aria-live="polite"');
  expect(markup).toContain('data-campaign-status-reason="subscription-required"');
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('data-campaign-status-reason="unverifiable-twitch"');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
});

test('non-automatable reward cards use the truthful remaining group label', () => {
  const pendingDrops = [
    drop({ id: 'subscription', acquisitionMethod: 'subscription' }),
    drop({
      id: 'native',
      claimed: true,
      progress: 100,
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
    }),
  ];

  const markup = renderToStaticMarkup(
    <RewardList
      pendingDrops={pendingDrops}
      completedDrops={[]}
      rewardsLoading={false}
      syncLoading={false}
      claimableCount={0}
    />,
  );

  expect(markup).toContain('Remaining (2)');
  expect(markup).not.toContain('Pending (2)');
});

test('farmable queue head keeps Start enabled despite farming-complete selection', () => {
  // Given
  const selectedGame = game({
    campaignId: 'selected-terminal',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const queueHead = game({
    campaignId: 'queue-farmable',
    campaignName: 'Queue Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(selectedGame), [queueHead]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (1)');
  expect(startButton).not.toContain(' disabled=');
  expect(markup).not.toContain('↑ first');
});

test('legacy queue head with a missing reward summary keeps Start enabled and does not claim first', () => {
  // Given
  const selectedGame = game({
    campaignId: 'selected-terminal',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const queueHead: TwitchGame = {
    id: 'queue-game-id',
    name: 'Queue Game',
    imageUrl: '',
    campaignId: 'queue-legacy',
    campaignName: 'Legacy Queue Campaign',
    isConnected: true,
    allDropsCompleted: false,
  };

  // When
  const markup = renderMainView(appState(selectedGame), [queueHead]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (1)');
  expect(startButton).not.toContain(' disabled=');
  expect(markup).not.toContain('↑ first');
});

test('all-acquired selection skips a terminal queue head and keeps a later farmable campaign enabled', () => {
  // Given
  const terminalHead = game({
    campaignId: 'terminal-head',
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  });
  const farmableCampaign = game({
    campaignId: 'later-farmable',
    campaignName: 'Later Farmable Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(terminalHead), [terminalHead, farmableCampaign]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (2)');
  expect(startButton).not.toContain(' disabled=');
});

test('no selection skips a farming-complete queue head and keeps a later farmable campaign enabled', () => {
  // Given
  const terminalHead = game({
    campaignId: 'terminal-head',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
  });
  const farmableCampaign = game({
    campaignId: 'later-farmable',
    campaignName: 'Later Farmable Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(null), [terminalHead, farmableCampaign]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (2)');
  expect(startButton).not.toContain(' disabled=');
});

test('farming-complete terminal render ignores false all-claimed message and keeps separate reasons', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });
  const state = {
    ...appState(selectedGame),
    lastStopReason: 'unverifiable-twitch',
    lastStopMessage: 'All rewards claimed',
  } satisfies AppState;

  // When
  const markup = renderMainView(state, [], { runtimeMode: 'stopped-terminal' });

  // Then
  expect(markup).not.toContain('All rewards claimed');
  expect(markup.match(/data-campaign-status-reason=/g)).toHaveLength(2);
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
});

test('typed farming-complete queue feedback reuses the selected-campaign status vocabulary', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame), [], {
    queueMessage: formatFarmingCompleteQueueMessage(selectedGame),
  });

  // Then
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
  expect(markup).not.toContain('already claimed');
});

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
