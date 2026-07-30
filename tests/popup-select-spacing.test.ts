import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const campaignSelectorSource = readFileSync(
  new URL('../src/popup/components/CampaignSelector.tsx', import.meta.url),
  'utf8',
);

test('campaign selector keeps its chevron inset from the right edge', () => {
  // Given the campaign selector markup
  const selectorMarkup = campaignSelectorSource.match(/<select[\s\S]*?<\/select>/)?.[0] ?? '';

  // When the selector is rendered with its dropdown affordance
  // Then the native arrow is replaced by an inset project icon with reserved text space
  expect(selectorMarkup).toContain('appearance-none');
  expect(selectorMarkup).toContain('pr-8');
  expect(campaignSelectorSource).toContain('right-3');
  expect(campaignSelectorSource).toContain('-rotate-90');
});
