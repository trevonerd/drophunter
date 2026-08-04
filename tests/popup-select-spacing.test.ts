import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const campaignListSource = readFileSync(
  new URL('../src/popup/components/CampaignList.tsx', import.meta.url),
  'utf8',
);

test('campaign toolbar keeps search flexible beside compact sort and filter controls', () => {
  expect(campaignListSource).toContain('dh-catalog-toolbar flex min-w-0 items-center gap-1.5');
  expect(campaignListSource).toContain('min-h-8 min-w-0 flex-1');
  expect(campaignListSource).toContain('aria-label="Sort games"');
  expect(campaignListSource).toContain('aria-label="Filter games"');
});
