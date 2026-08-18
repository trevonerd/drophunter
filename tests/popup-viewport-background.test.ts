import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/popup/index.css', import.meta.url), 'utf8');

test('popup paints one continuous background across the full browser viewport', () => {
  expect(css).toMatch(/html\s*\{[\s\S]*?min-height:\s*100%;/);
  expect(css).toMatch(/html\s*\{[\s\S]*?background-repeat:\s*no-repeat;/);
  expect(css).toMatch(/html\s*\{[\s\S]*?background-attachment:\s*fixed;/);
});
