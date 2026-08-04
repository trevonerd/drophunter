import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('popup entry establishes its width before the React module executes', () => {
  // Given
  const html = readFileSync(new URL('../src/entrypoints/popup/index.html', import.meta.url), 'utf8');

  // When
  const criticalStyleIndex = html.indexOf('data-popup-critical-size');
  const reactModuleIndex = html.indexOf('<script type="module"');

  // Then
  expect(criticalStyleIndex).toBeGreaterThan(0);
  expect(criticalStyleIndex).toBeLessThan(reactModuleIndex);
  expect(html).toContain(
    'html,\n      body,\n      #root {\n        width: 400px;\n        min-width: 400px;',
  );
  expect(html).not.toContain('max-width: 100%');
  expect(html).not.toContain('max-width: 100vw');
});

test('popup entry renders a stable loading shell before React mounts', () => {
  // Given
  const html = readFileSync(new URL('../src/entrypoints/popup/index.html', import.meta.url), 'utf8');

  // When
  const rootIndex = html.indexOf('<div id="root">');
  const loadingShellIndex = html.indexOf('<div data-popup-boot-shell', rootIndex);
  const reactModuleIndex = html.indexOf('<script type="module"');

  // Then
  expect(rootIndex).toBeGreaterThan(0);
  expect(loadingShellIndex).toBeGreaterThan(rootIndex);
  expect(loadingShellIndex).toBeLessThan(reactModuleIndex);
  expect(html).toContain('min-height: 128px');
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-label="Loading DropHunter"');
});

test('popup releases its bootstrap geometry after the first React frame', () => {
  // Given
  const source = readFileSync(new URL('../src/popup/main.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/popup/index.css', import.meta.url), 'utf8');

  // Then
  expect(source).toContain("document.querySelector('[data-popup-critical-size]')");
  expect(source).toContain('requestAnimationFrame(() => criticalSizeStyle?.remove())');
  expect(css).toMatch(/body \{[\s\S]*?min-height: 128px;/);
  expect(css).toMatch(/#root \{[\s\S]*?min-height: 128px;/);
});
