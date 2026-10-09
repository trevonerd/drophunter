import type { AppState } from '../types/index.ts';

type TransactionalSettingKey =
  | 'monitorAutoOpen'
  | 'muteFarmingTab'
  | 'twitchAdblockEnabled'
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
  const pending = new Map<
    TransactionalSettingKey,
    { confirmed: Partial<AppState>; confirmedRevision: number; count: number; latestPending: boolean }
  >();

  const run = async <
    Key extends TransactionalSettingKey,
    CommandResponse extends SettingsTransactionResponse,
  >(
    spec: SettingsTransactionSpec<Key, CommandResponse>,
  ): Promise<SettingsTransactionResult> => {
    const transaction = pending.get(spec.key) ?? {
      confirmed: { [spec.key]: options.read(spec.key) },
      confirmedRevision: 0,
      count: 0,
      latestPending: true,
    };
    pending.set(spec.key, transaction);
    transaction.count += 1;
    transaction.latestPending = true;
    const revision = (revisions.get(spec.key) ?? 0) + 1;
    revisions.set(spec.key, revision);
    options.write(spec.key, spec.next);
    const isCurrent = () => revisions.get(spec.key) === revision;

    try {
      if (spec.authorize) {
        let authorized = false;
        try {
          authorized = await spec.authorize();
        } catch {
          authorized = false;
        }
        if (!isCurrent()) return { kind: 'stale' };
        if (!authorized) {
          transaction.latestPending = false;
          options.patch(transaction.confirmed);
          return { kind: 'rejected', reason: 'permission' };
        }
      }

      let response: CommandResponse | undefined;
      try {
        response = await spec.send();
      } catch {
        response = undefined;
      }
      if (response?.success && revision > transaction.confirmedRevision) {
        const patch = { [spec.key]: spec.next, ...spec.successPatch?.(response) };
        transaction.confirmed = patch;
        transaction.confirmedRevision = revision;
        if (isCurrent()) options.patch(patch);
        else if (!transaction.latestPending) options.patch(transaction.confirmed);
      }
      if (!isCurrent()) return { kind: 'stale' };
      transaction.latestPending = false;
      if (!response?.success) {
        options.patch(transaction.confirmed);
        return { kind: 'rejected', reason: 'runtime' };
      }
      return { kind: 'committed' };
    } finally {
      transaction.count -= 1;
      if (!transaction.count) pending.delete(spec.key);
    }
  };

  return { run };
}
