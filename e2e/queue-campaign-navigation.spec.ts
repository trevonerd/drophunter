import { expect, test } from '@playwright/test';
import {
  createExtensionProfile,
  fixtureDrop,
  fixtureGame,
  openPopup,
  seedAppState,
} from './extension-fixture';

const firstCampaign = {
  ...fixtureGame,
  id: 'navigation-game',
  campaignId: 'navigation-campaign-one',
  name: 'Navigation Game',
  campaignName: 'First campaign',
  categorySlug: 'navigation-game',
  imageUrl: '',
  dropCount: 1,
};

const secondCampaign = {
  ...firstCampaign,
  campaignId: 'navigation-campaign-two',
  campaignName: 'Second campaign',
};

const otherCampaign = {
  ...fixtureGame,
  id: 'other-navigation-game',
  campaignId: 'other-navigation-campaign',
  name: 'Other Navigation Game',
  campaignName: 'Other campaign',
  categorySlug: 'other-navigation-game',
  imageUrl: '',
  dropCount: 1,
};

const targetLabel = 'Navigation Game · Second campaign';
const targetArticle = '[data-campaign-key="campaign:navigation-campaign-two"]';

async function createNavigationProfile(patch: Record<string, unknown> = {}) {
  const seedProfile = await createExtensionProfile();
  const campaigns = [firstCampaign, secondCampaign, otherCampaign];
  const drops = campaigns.map((campaign) => ({
    ...fixtureDrop,
    id: `${campaign.campaignId}-drop`,
    campaignId: campaign.campaignId,
    gameId: campaign.id,
    gameName: campaign.name,
    name: `${campaign.campaignName} reward`,
  }));
  const earlierGames = Array.from({ length: 10 }, (_, index) => ({
    ...fixtureGame,
    id: `earlier-game-${index}`,
    campaignId: `earlier-campaign-${index}`,
    name: `Earlier Game ${index}`,
  }));
  try {
    await seedAppState(seedProfile, {
      availableGames: [...earlierGames, ...campaigns],
      selectedGame: null,
      queue: [firstCampaign, secondCampaign],
      currentDrop: null,
      pendingDrops: drops,
      allDrops: drops,
      isRunning: false,
      isPaused: false,
      wasRunning: false,
      autoStartFavoriteGames: false,
      manualQueueAuthorized: true,
      activeStreamer: null,
      tabId: null,
      favoriteGames: [],
      hiddenGames: [],
      ...patch,
    });
    await seedProfile.shutdown();
    const profile = await createExtensionProfile(seedProfile.userDataDir);
    return {
      ...profile,
      async close() {
        await profile.shutdown();
        await seedProfile.close();
      },
    };
  } catch (error) {
    await seedProfile.close();
    throw error;
  }
}

async function readQueueState(page: Awaited<ReturnType<typeof openPopup>>) {
  return page.evaluate(async () => {
    const { appState } = await chrome.storage.local.get('appState');
    const state = appState as Record<string, unknown>;
    return {
      selectedGame: state.selectedGame,
      queue: (state.queue as Array<{ campaignId: string }>).map((game) => game.campaignId),
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      wasRunning: state.wasRunning,
      manualQueueAuthorized: state.manualQueueAuthorized,
      activeStreamer: state.activeStreamer,
      tabId: state.tabId,
    };
  });
}

test('queue campaign navigation opens the exact campaign and supports repeated keyboard activation', async () => {
  const profile = await createNavigationProfile();
  try {
    const popup = await openPopup(profile);
    await popup.setViewportSize({ width: 400, height: 500 });
    const showTarget = popup.getByRole('button', { name: `Show Drops for ${targetLabel}` });
    const group = popup.locator('[data-game-key="navigation-game"]');
    await expect(showTarget).toBeVisible();
    await expect(group).not.toBeInViewport();
    const before = await readQueueState(popup);

    await showTarget.click();
    await expect(group).toHaveAttribute('data-expanded', 'true');
    await expect(popup.locator(targetArticle)).toBeVisible();
    await expect(popup.locator(targetArticle)).toBeInViewport();
    await expect(popup.locator(targetArticle)).toBeFocused();
    await expect(
      popup.locator(targetArticle).getByText('Second campaign reward', { exact: true }),
    ).toBeVisible();
    await expect(
      popup
        .getByRole('region', { name: 'Farming queue', exact: true })
        .getByRole('button', { name: `Remove ${targetLabel} from queue` }),
    ).toBeVisible();

    // Collapse the game and activate the queue navigation button with Enter,
    // then repeat after collapsing it again with Space.
    await group.getByRole('button', { expanded: true }).click();
    await expect(group).toHaveAttribute('data-expanded', 'false');
    await showTarget.focus();
    await showTarget.press('Enter');
    await expect(popup.locator(targetArticle)).toBeVisible();

    await group.getByRole('button', { expanded: true }).click();
    await expect(group).toHaveAttribute('data-expanded', 'false');
    await showTarget.focus();
    await showTarget.press('Space');
    await expect(popup.locator(targetArticle)).toBeVisible();
    await expect(popup.locator(targetArticle)).toBeInViewport();
    expect(await readQueueState(popup)).toEqual(before);
  } finally {
    await profile.close();
  }
});

test('queue navigation clears search and restores a campaign excluded by the favorites filter', async () => {
  const profile = await createNavigationProfile({
    favoriteGames: [
      {
        gameId: otherCampaign.id,
        lastKnownName: otherCampaign.name,
        addedAt: Date.now(),
        identityKeys: [otherCampaign.categorySlug],
      },
    ],
  });
  try {
    const worker = profile.context.serviceWorkers().find((item) => item.url().endsWith('/background.js'));
    if (!worker) throw new Error('Missing extension worker');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        campaignCatalogPreferences: { sortMode: 'ending-soonest', filter: 'favorites-only' },
      });
    });

    const popup = await openPopup(profile);
    await expect(popup.getByLabel('Filter games')).toHaveValue('favorites-only');
    await popup.getByLabel('Search campaigns').fill('no campaign matches this');
    await expect(popup.locator('[data-game-key]')).toHaveCount(0);

    await popup.getByRole('button', { name: `Show Drops for ${targetLabel}` }).click();
    await expect(popup.getByLabel('Search campaigns')).toHaveValue('');
    await expect(popup.getByLabel('Filter games')).toHaveValue('available');
    await expect(popup.locator(targetArticle)).toBeVisible();
    expect(
      await popup.evaluate(async () => {
        const stored = await chrome.storage.local.get('campaignCatalogPreferences');
        return (stored.campaignCatalogPreferences as { filter: string }).filter;
      }),
    ).toBe('favorites-only');
  } finally {
    await profile.close();
  }
});

test('queue navigation reveals a hidden campaign while preserving its hidden preference', async () => {
  const profile = await createNavigationProfile({
    hiddenGames: [
      {
        gameId: firstCampaign.id,
        lastKnownName: firstCampaign.name,
        hiddenAt: Date.now(),
        identityKeys: [firstCampaign.categorySlug],
      },
    ],
  });
  try {
    const popup = await openPopup(profile);
    const beforeHiddenGames = await popup.evaluate(async () => {
      const { appState } = await chrome.storage.local.get('appState');
      return (appState as { hiddenGames: unknown[] }).hiddenGames;
    });

    await popup.getByRole('button', { name: `Show Drops for ${targetLabel}` }).click();
    await expect(popup.getByLabel('Filter games')).toHaveValue('hidden-only');
    await expect(popup.locator(targetArticle)).toBeVisible();
    await expect(popup.locator('[data-game-key="navigation-game"]')).toHaveAttribute('data-expanded', 'true');
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const { appState } = await chrome.storage.local.get('appState');
          return (appState as { hiddenGames: unknown[] }).hiddenGames;
        }),
      )
      .toEqual(beforeHiddenGames);
  } finally {
    await profile.close();
  }
});

test('remove and reorder queue controls do not open campaign details', async () => {
  const profile = await createNavigationProfile();
  try {
    const popup = await openPopup(profile);
    const group = popup.locator('[data-game-key="navigation-game"]');
    await expect(group).toHaveAttribute('data-expanded', 'false');

    await popup
      .getByRole('button', { name: `Reorder ${targetLabel}. Use arrow keys to move.` })
      .press('ArrowUp');
    await expect
      .poll(async () => (await readQueueState(popup)).queue)
      .toEqual(['navigation-campaign-two', 'navigation-campaign-one']);
    await expect(group).toHaveAttribute('data-expanded', 'false');

    await popup.getByRole('button', { name: `Remove ${targetLabel} from queue` }).click();
    await expect.poll(async () => (await readQueueState(popup)).queue).toEqual(['navigation-campaign-one']);
    await expect(group).toHaveAttribute('data-expanded', 'false');
    await expect(popup.locator(targetArticle)).toBeHidden();
  } finally {
    await profile.close();
  }
});
