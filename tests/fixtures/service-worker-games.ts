import type { TwitchGame } from '../../src/types/index.ts';

export const demoGame: TwitchGame = {
  id: 'game-1',
  name: 'Demo Game',
  imageUrl: 'https://example.com/demo.png',
  campaignId: 'campaign-1',
  categorySlug: 'demo-game',
};

export const nextGame: TwitchGame = {
  id: 'queue-next-game',
  name: 'Next Game',
  imageUrl: 'https://example.com/next.png',
  campaignId: 'queue-next-campaign',
  categorySlug: 'next-game',
};

export const thirdGame: TwitchGame = {
  id: 'queue-third-game',
  name: 'Third Game',
  imageUrl: 'https://example.com/third.png',
  campaignId: 'queue-third-campaign',
  categorySlug: 'third-game',
};
