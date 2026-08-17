import { describe, expect, test } from 'bun:test';
import { createSettingsTransactionCoordinator } from '../src/popup/settings-transaction.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { AppState } from '../src/types/index.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

function createSubject() {
  let state: AppState = {
    ...createInitialState(),
    monitorAutoOpen: false,
    notificationsEnabled: false,
    autoStartFavoriteGames: false,
    watchTransportPreference: 'tabless',
  };
  const coordinator = createSettingsTransactionCoordinator({
    read: (key) => state[key],
    write: (key, value) => {
      state = { ...state, [key]: value };
    },
    patch: (values) => {
      state = { ...state, ...values };
    },
  });
  return {
    coordinator,
    state: () => state,
  };
}

describe('settings transaction coordinator', () => {
  test('rolls back the optimistic value when the runtime rejects it', async () => {
    // Given: an initially disabled setting and a rejected runtime command.
    const subject = createSubject();

    // When: the setting is optimistically enabled.
    const result = await subject.coordinator.run({
      key: 'monitorAutoOpen',
      next: true,
      send: async () => ({ success: false }),
    });

    // Then: the durable rejection restores the prior value.
    expect(result).toEqual({ kind: 'rejected', reason: 'runtime' });
    expect(subject.state().monitorAutoOpen).toBe(false);
  });

  test('ignores an older response after a newer command commits', async () => {
    // Given: two commands for the same setting whose responses arrive in reverse order.
    const subject = createSubject();
    const firstResponse = createDeferred<{ success: boolean; monitorAutoOpen: boolean }>();
    const secondResponse = createDeferred<{ success: boolean; monitorAutoOpen: boolean }>();

    // When: disable supersedes enable before the first response arrives.
    const first = subject.coordinator.run({
      key: 'monitorAutoOpen',
      next: true,
      send: () => firstResponse.promise,
      successPatch: (response) => ({ monitorAutoOpen: response.monitorAutoOpen }),
    });
    const second = subject.coordinator.run({
      key: 'monitorAutoOpen',
      next: false,
      send: () => secondResponse.promise,
      successPatch: (response) => ({ monitorAutoOpen: response.monitorAutoOpen }),
    });
    secondResponse.resolve({ success: true, monitorAutoOpen: false });
    await second;
    firstResponse.resolve({ success: true, monitorAutoOpen: true });

    // Then: the late enable response cannot overwrite the newer disable.
    expect(await first).toEqual({ kind: 'stale' });
    expect(subject.state().monitorAutoOpen).toBe(false);
  });

  test('rolls back permission denial without sending the runtime command', async () => {
    // Given: a permission-gated setting and a denied request.
    const subject = createSubject();
    let sends = 0;

    // When: authorization fails before the runtime command.
    const result = await subject.coordinator.run({
      key: 'notificationsEnabled',
      next: true,
      authorize: async () => false,
      send: async () => {
        sends += 1;
        return { success: true };
      },
    });

    // Then: the optimistic value rolls back and no command escapes the gate.
    expect(result).toEqual({ kind: 'rejected', reason: 'permission' });
    expect(subject.state().notificationsEnabled).toBe(false);
    expect(sends).toBe(0);
  });

  test('applies a typed success patch across related settings', async () => {
    // Given: enabling favorite automation also enables notifications.
    const subject = createSubject();

    // When: the runtime accepts the command.
    await subject.coordinator.run({
      key: 'autoStartFavoriteGames',
      next: true,
      send: async () => ({ success: true, autoStartFavoriteGames: true }),
      successPatch: (response): Partial<AppState> => ({
        autoStartFavoriteGames: response.autoStartFavoriteGames,
        notificationsEnabled: true,
      }),
    });

    // Then: both related projections commit together.
    expect(subject.state().autoStartFavoriteGames).toBe(true);
    expect(subject.state().notificationsEnabled).toBe(true);
  });

  test('restores the previous watch mode when its command fails', async () => {
    const subject = createSubject();

    await subject.coordinator.run({
      key: 'watchTransportPreference',
      next: 'managed-tab',
      send: async () => ({ success: false }),
    });

    expect(subject.state().watchTransportPreference).toBe('tabless');
  });
});
