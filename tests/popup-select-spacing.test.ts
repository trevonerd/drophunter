import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const campaignListSource = readFileSync(
  new URL('../src/popup/components/CampaignList.tsx', import.meta.url),
  'utf8',
);
const popupStyles = readFileSync(new URL('../src/popup/index.css', import.meta.url), 'utf8');

test('campaign toolbar keeps search flexible beside compact sort and filter controls', () => {
  expect(campaignListSource).toContain('dh-catalog-toolbar flex min-w-0 items-center gap-1.5');
  expect(campaignListSource).toContain('min-h-8 min-w-0 flex-1');
  expect(campaignListSource).toContain('aria-label="Sort games"');
  expect(campaignListSource).toContain('aria-label="Filter games"');
});

test('transparent catalog selects retain a visible keyboard focus indicator', () => {
  expect(popupStyles).toContain('.dh-catalog-tool:focus-within');
  expect(popupStyles).toContain('box-shadow: 0 0 0 2px var(--dh-focus);');
});

test('Undo always hands focus back before its feedback is removed', () => {
  expect(campaignListSource).toContain(
    'setCatalogFeedback(null);\n              filterSelectRef.current?.focus();',
  );
});
