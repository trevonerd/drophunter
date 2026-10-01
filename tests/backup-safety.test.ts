import { describe, expect, test } from 'bun:test';
import { applyBackup, exportBackup, inspectBackup } from '../src/shared/backup.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ClaimLogEntry } from '../src/types/index.ts';

const entry = (imageUrl: string): ClaimLogEntry => ({
  id: 'drop::campaign',
  dropId: 'drop',
  dropName: 'Reward',
  gameId: 'game',
  gameName: 'Game',
  campaignLabel: 'Game',
  claimedAt: 1,
  imageUrl,
});
describe('backup import safety', () => {
  test('trusted images survive and unsafe optional images never discard history', () => {
    const file = exportBackup(createInitialState(), [], 'old');
    const safe = 'https://static-cdn.jtvnw.net/reward.png';
    for (const imageUrl of [
      safe,
      'https://evil.example/reward.png',
      'https://static-cdn.jtvnw.net.evil.example/a',
      'https://user:pass@static-cdn.jtvnw.net/a',
      'https://static-cdn.jtvnw.net:443/a',
      'http://static-cdn.jtvnw.net/a',
      'data:image/png;base64,AAAA',
      '',
    ]) {
      file.sections.history = { version: 1, data: [entry(imageUrl)] };
      const inspection = inspectBackup(file);
      const result = applyBackup(createInitialState(), [], file, {
        mode: 'replace',
        settings: 'local',
        sections: ['history'],
      });
      expect(result.claimLog).toHaveLength(1);
      expect(result.claimLog[0]?.imageUrl).toBe(imageUrl === safe ? safe : undefined);
      expect(
        inspection.sections.find((section) => section.id === 'history')?.unknownFields?.includes('imageUrl'),
      ).toBe(imageUrl !== safe && imageUrl !== '');
    }
    expect(
      exportBackup(createInitialState(), [entry('https://evil.example/a')], 'old').sections.history?.data,
    ).toEqual([{ ...entry('https://evil.example/a'), imageUrl: undefined }]);
  });
  test('replace reports classifications excluded by untouched local sections', () => {
    const local = createInitialState();
    local.hiddenGames = [{ gameId: 'game', lastKnownName: 'Game', hiddenAt: 1 }];
    const remote = createInitialState();
    remote.favoriteGames = [{ gameId: 'game', lastKnownName: 'Game', addedAt: 1 }];
    const result = applyBackup(local, [], exportBackup(remote, [], 'old'), {
      mode: 'replace',
      settings: 'local',
      sections: ['favorites'],
    });
    expect(result.appState.favoriteGames).toEqual([]);
    expect(result.appState.hiddenGames).toEqual(local.hiddenGames);
    expect(result.summary.warnings[0]).toContain('Select both Favorites and Hidden categories');
    const inverse = applyBackup(remote, [], exportBackup(local, [], 'old'), {
      mode: 'replace',
      settings: 'local',
      sections: ['hidden'],
    });
    expect(inverse.summary.warnings[0]).toContain('favorites locally');
    const both = applyBackup(local, [], exportBackup(remote, [], 'old'), {
      mode: 'replace',
      settings: 'local',
      sections: ['favorites', 'hidden'],
    });
    expect(both.summary.warnings).toEqual([]);
    expect(both.appState.favoriteGames).toHaveLength(1);
  });
  test('oversized exports fail before download', () => {
    const huge = entry('');
    huge.dropName = 'x'.repeat(10 * 1024 * 1024);
    expect(() => exportBackup(createInitialState(), [huge], 'old')).toThrow('Backup exceeds 10 MiB');
  });
});
