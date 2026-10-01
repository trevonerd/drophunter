import { describe, expect, test } from 'bun:test';
import { applyBackup, exportBackup, inspectBackup } from '../src/shared/backup.ts';
import { migrateBackupSection } from '../src/shared/backup-migrations.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ClaimLogEntry } from '../src/types/index.ts';
import publishedBackup from './fixtures/backup/v1-beta49.json';

const options = {
  mode: 'merge',
  settings: 'backup',
  sections: ['settings', 'favorites', 'hidden', 'statistics', 'history'],
} as const;
const log = (id: string): ClaimLogEntry => ({
  id,
  dropId: 'same',
  dropName: 'Drop',
  gameId: 'game',
  gameName: 'Game',
  campaignLabel: 'Game',
  claimedAt: 1,
});
describe('portable backup', () => {
  test('category aliases merge without losing local names or mutating originals', () => {
    const local = createInitialState();
    local.favoriteGames = [
      { gameId: 'canonical', lastKnownName: 'Local name', addedAt: 1, identityKeys: ['shared'] },
    ];
    const remote = createInitialState();
    remote.favoriteGames = [
      { gameId: 'old-id', lastKnownName: 'Old name', addedAt: 2, identityKeys: ['shared', 'new-alias'] },
    ];
    const result = applyBackup(local, [], exportBackup(remote, [], 'old'), {
      mode: 'merge',
      settings: 'local',
      sections: ['favorites'],
    });
    expect(result.appState.favoriteGames).toEqual([
      {
        gameId: 'canonical',
        lastKnownName: 'Local name',
        addedAt: 1,
        identityKeys: ['old-id', 'shared', 'new-alias'],
      },
    ]);
    expect(local.favoriteGames[0]?.identityKeys).toEqual(['shared']);
  });
  test('duplicate selections and inherited section names are rejected', () => {
    const file = exportBackup(createInitialState(), [], 'old');
    for (const sections of [['statistics', 'statistics'], ['constructor']])
      expect(() =>
        applyBackup(createInitialState(), [], file, { mode: 'merge', settings: 'local', sections }),
      ).toThrow();
  });
  test('overflow and oversized files fail safely', () => {
    const local = createInitialState();
    local.totalChannelPointsClaimed = Number.MAX_SAFE_INTEGER;
    const file = exportBackup(createInitialState(), [], 'old');
    file.sections.statistics = { version: 1, data: { totalChannelPointsClaimed: 1 } };
    expect(() =>
      applyBackup(local, [], file, { mode: 'merge', settings: 'local', sections: ['statistics'] }),
    ).toThrow();
    expect(inspectBackup({ padding: 'x'.repeat(10 * 1024 * 1024) }).error).toContain('10 MiB');
  });
  test('merge resolves imported category contradictions and preserves local choices', () => {
    const local = createInitialState();
    local.favoriteGames = [{ gameId: 'local', lastKnownName: 'Local', addedAt: 1 }];
    local.muteFarmingTab = true;
    const remote = createInitialState();
    remote.favoriteGames = [{ gameId: 'both', lastKnownName: 'Both', addedAt: 1 }];
    remote.hiddenGames = [
      { gameId: 'both', lastKnownName: 'Both', hiddenAt: 1 },
      { gameId: 'local', lastKnownName: 'Local', hiddenAt: 1 },
    ];
    remote.muteFarmingTab = false;
    const result = applyBackup(local, [], exportBackup(remote, [], 'old'), {
      mode: 'merge',
      settings: 'local',
      sections: ['favorites', 'hidden', 'settings'],
    });
    expect(result.appState.favoriteGames.map((g) => g.gameId)).toEqual(['local']);
    expect(result.appState.hiddenGames.map((g) => g.gameId)).toEqual(['both']);
    expect(result.appState.muteFarmingTab).toBe(true);
  });
  test('published v1 fixture remains importable', () => {
    expect(inspectBackup(publishedBackup).compatibility).toBe('compatible');
    const result = applyBackup(createInitialState(), [], publishedBackup, {
      mode: 'replace',
      settings: 'backup',
      sections: Object.keys(publishedBackup.sections),
    });
    expect(result.summary.totalChannelPointsClaimed).toBe(100);
    expect(result.summary.favorites).toBe(1);
  });
  test('round trip uses explicit whitelist and disables restored automation', () => {
    const state = createInitialState();
    state.notificationsEnabled = true;
    state.autoStartFavoriteGames = true;
    const file = exportBackup(state, [], '4.0.0-beta.49');
    expect(JSON.stringify(file)).not.toContain('telegram');
    expect(JSON.stringify(file)).not.toContain('queue');
    expect(inspectBackup(file).compatibility).toBe('compatible');
    const result = applyBackup(createInitialState(), [], file, {
      ...options,
      sections: [...options.sections],
    });
    expect(result.appState.notificationsEnabled).toBe(false);
    expect(result.appState.autoStartFavoriteGames).toBe(false);
    expect(result.summary.reactivationRequired).toBe(true);
  });
  test('unknown fields are excluded, new sections and versions allow partial import', () => {
    const file = exportBackup(createInitialState(), [], 'future');
    file.sections.settings = { version: 1, data: { muteFarmingTab: false, futureSetting: true } };
    file.sections.future = { version: 1, data: {} };
    file.sections.history = { version: 99, data: [] };
    const inspection = inspectBackup(file);
    expect(inspection.compatibility).toBe('partial');
    expect(inspection.file?.sections.settings?.data).toEqual({ muteFarmingTab: false });
    expect(() =>
      applyBackup(createInitialState(), [], file, {
        mode: 'merge',
        settings: 'backup',
        sections: ['future'],
      }),
    ).toThrow();
  });
  test('old partial settings preserve missing new settings even on replace', () => {
    const state = createInitialState();
    state.muteFarmingTab = true;
    const file = exportBackup(state, [], 'old');
    file.sections.settings = { version: 1, data: { monitorAutoOpen: false } };
    expect(
      applyBackup(state, [], file, { mode: 'replace', settings: 'backup', sections: ['settings'] }).appState
        .muteFarmingTab,
    ).toBe(true);
  });
  test('strict invalid known data blocks section and radical container blocks file', () => {
    const file = exportBackup(createInitialState(), [], 'old');
    file.sections.statistics = { version: 1, data: { totalDropsClaimed: -1 } };
    expect(inspectBackup(file).sections.find((s) => s.id === 'statistics')?.compatible).toBe(false);
    file.formatVersion = 2;
    expect(inspectBackup(file).compatibility).toBe('incompatible');
  });
  test('prototype-shaped sections and empty history IDs cannot be applied', () => {
    const file = exportBackup(createInitialState(), [], 'old');
    Object.defineProperty(file.sections, 'constructor', {
      enumerable: true,
      value: { version: 1, data: {} },
    });
    file.sections.history = { version: 1, data: [log('')] };
    const inspection = inspectBackup(file);
    expect(inspection.sections.find((s) => s.id === 'constructor')?.compatible).toBe(false);
    expect(inspection.sections.find((s) => s.id === 'history')?.compatible).toBe(false);
  });
  test('points add on repeated imports; campaign history deduplicates and floors local count', () => {
    const local = createInitialState();
    local.totalChannelPointsClaimed = 10;
    local.totalDropsClaimed = 8;
    const remote = createInitialState();
    remote.totalChannelPointsClaimed = 20;
    const file = exportBackup(remote, [log('campaign-a:same'), log('campaign-b:same')], 'old');
    const first = applyBackup(local, [log('campaign-a:same')], file, {
      ...options,
      sections: [...options.sections],
    });
    expect(first.claimLog).toHaveLength(2);
    expect(first.appState.totalDropsClaimed).toBe(8);
    expect(first.appState.totalChannelPointsClaimed).toBe(30);
    expect(
      applyBackup(first.appState, first.claimLog, file, { ...options, sections: [...options.sections] })
        .appState.totalChannelPointsClaimed,
    ).toBe(50);
  });
  test('drop count is calculated before history retention', () => {
    const file = exportBackup(
      createInitialState(),
      Array.from({ length: 5001 }, (_, i) => log(`campaign:${i}`)),
      'old',
    );
    const result = applyBackup(createInitialState(), [], file, {
      ...options,
      sections: [...options.sections],
    });
    expect(result.claimLog).toHaveLength(5000);
    expect(result.appState.totalDropsClaimed).toBe(5001);
  });
  test('migration chain preserves data and rejects missing steps', () => {
    expect(
      migrateBackupSection({ old: true }, 1, 3, {
        1: (data) => ({ ...(data as object), second: true }),
        2: (data) => ({ ...(data as object), third: true }),
      }),
    ).toEqual({ migrated: true, data: { old: true, second: true, third: true } });
    expect(() => migrateBackupSection({}, 1, 3, { 1: (data) => data })).toThrow();
  });
});
