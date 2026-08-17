import type { AppState } from '../types/index.ts';

export type TransactionalSettingKey =
  | 'monitorAutoOpen'
  | 'autoResumeOnStartup'
  | 'muteFarmingTab'
  | 'autoClaimChannelPointsBonus'
  | 'autoClaimDrops'
  | 'notificationsEnabled'
  | 'autoStartFavoriteGames'
  | 'farmCategoryScope'
  | 'watchTransportPreference'
  | 'streamerSelectionMode'
  | 'preferredStreamerLanguage';

type SettingsTransactionResult =
  | { readonly kind: 'committed' }
  | { readonly kind: 'rejected'; readonly reason: 'permission' | 'runtime' }
  | { readonly kind: 'stale' };

type SettingsTransactionResponse = { readonly success: boolean };

interface SettingsTransactionOptions {
  readonly read: <Key extends TransactionalSettingKey>(key: Key) => AppState[Key];
  readonly write: <Key extends TransactionalSettingKey>(key: Key, value: AppState[Key]) => void;
  readonly patch: (values: Partial<AppState>) => void;
}

interface SettingsTransactionSpec<
  Key extends TransactionalSettingKey,
  CommandResponse extends SettingsTransactionResponse,
> {
  readonly key: Key;
  readonly next: AppState[Key];
  readonly authorize?: () => Promise<boolean>;
  readonly send: () => Promise<CommandResponse | undefined>;
  readonly successPatch?: (response: CommandResponse) => Partial<AppState>;
}

export interface SettingsTransactionCoordinator {
  readonly run: <Key extends TransactionalSettingKey, CommandResponse extends SettingsTransactionResponse>(
    spec: SettingsTransactionSpec<Key, CommandResponse>,
  ) => Promise<SettingsTransactionResult>;
}

export function createSettingsTransactionCoordinator(
  options: SettingsTransactionOptions,
): SettingsTransactionCoordinator {
  const revisions = new Map<TransactionalSettingKey, number>();

  const run = async <
    Key extends TransactionalSettingKey,
    CommandResponse extends SettingsTransactionResponse,
  >(
    spec: SettingsTransactionSpec<Key, CommandResponse>,
  ): Promise<SettingsTransactionResult> => {
    const previous = options.read(spec.key);
    const revision = (revisions.get(spec.key) ?? 0) + 1;
    revisions.set(spec.key, revision);
    options.write(spec.key, spec.next);
    const isCurrent = () => revisions.get(spec.key) === revision;

    if (spec.authorize) {
      let authorized = false;
      try {
        authorized = await spec.authorize();
      } catch {
        authorized = false;
      }
      if (!isCurrent()) return { kind: 'stale' };
      if (!authorized) {
        options.write(spec.key, previous);
        return { kind: 'rejected', reason: 'permission' };
      }
    }

    let response: CommandResponse | undefined;
    try {
      response = await spec.send();
    } catch {
      response = undefined;
    }
    if (!isCurrent()) return { kind: 'stale' };
    if (!response?.success) {
      options.write(spec.key, previous);
      return { kind: 'rejected', reason: 'runtime' };
    }
    if (spec.successPatch) options.patch(spec.successPatch(response));
    return { kind: 'committed' };
  };

  return { run };
}
