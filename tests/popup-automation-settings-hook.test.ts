import { describe, expect, test } from 'bun:test';

describe('popup automation settings hook', () => {
  test('wires the user-facing automation settings through the typed runtime protocol', async () => {
    const source = await Bun.file('src/popup/hooks/useSettingsToggles.ts').text();

    expect(source).toContain("type: 'SET_AUTO_START_FAVORITES'");
    expect(source).not.toContain("type: 'SET_CAMPAIGN_PRIORITY_MODE'");
    expect(source).toContain("type: 'SET_FARM_CATEGORY_SCOPE'");
    expect(source).toContain("type: 'SET_WATCH_TRANSPORT_MODE'");
    const autoStartHandler = source.slice(
      source.indexOf('const handleAutoStartFavoriteGamesToggle'),
      source.indexOf('const handleFarmCategoryScopeChange'),
    );
    expect(autoStartHandler).not.toContain('authorize:');
    expect(autoStartHandler).not.toContain('notificationsEnabled:');
  });
});
