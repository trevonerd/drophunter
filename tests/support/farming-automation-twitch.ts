import type { TwitchGame, TwitchStreamer } from '../../src/types/index.ts';
import type { ExecutionBarrier } from './farming-automation-fixtures.ts';
import { cloneFixture, createExecutionBarrier } from './farming-automation-fixtures.ts';

export interface FarmingAutomationTwitchSnapshot {
  readonly games: readonly TwitchGame[];
  readonly updatedAt: number;
}

export interface FarmingAutomationTwitchOptions {
  readonly games?: readonly TwitchGame[];
  readonly streamersByCampaign?: Readonly<Record<string, readonly TwitchStreamer[]>>;
  readonly sessionAvailable?: boolean;
}

export interface FarmingAutomationTwitch {
  readonly refreshCount: number;
  readonly directoryCount: number;
  readonly failures: readonly TwitchFailureRecord[];
  readonly getSnapshot: () => Promise<FarmingAutomationTwitchSnapshot>;
  readonly refresh: () => Promise<FarmingAutomationTwitchSnapshot>;
  readonly getStreamers: (campaignKey: string) => Promise<readonly TwitchStreamer[]>;
  readonly hasSession: () => Promise<boolean>;
  readonly setGames: (games: readonly TwitchGame[]) => void;
  readonly setStreamers: (campaignKey: string, streamers: readonly TwitchStreamer[]) => void;
  readonly setSessionAvailable: (available: boolean) => void;
  readonly blockNextRefresh: () => ExecutionBarrier<void>;
  readonly failNextRefresh: (error: Error) => void;
  readonly failNextDirectory: (error: Error) => void;
}

export interface TwitchFailureRecord {
  readonly operation: 'refresh' | 'directory';
  readonly message: string;
}

function copyGames(games: readonly TwitchGame[]): readonly TwitchGame[] {
  return games.map((game) => cloneFixture(game));
}

export function createFarmingAutomationTwitch(
  options: FarmingAutomationTwitchOptions = {},
): FarmingAutomationTwitch {
  let games = copyGames(options.games ?? []);
  let streamersByCampaign = new Map<string, readonly TwitchStreamer[]>(
    Object.entries(options.streamersByCampaign ?? {}).map(([key, streamers]) => [
      key,
      copyFixtureList(streamers),
    ]),
  );
  let sessionAvailable = options.sessionAvailable ?? true;
  let snapshot: FarmingAutomationTwitchSnapshot = { games, updatedAt: 0 };
  let refreshCount = 0;
  let directoryCount = 0;
  let refreshFailure: Error | null = null;
  let directoryFailure: Error | null = null;
  let refreshBarrier: ExecutionBarrier<void> | null = null;
  let failureRecords: TwitchFailureRecord[] = [];

  const adapter: FarmingAutomationTwitch = {
    get refreshCount() {
      return refreshCount;
    },
    get directoryCount() {
      return directoryCount;
    },
    get failures() {
      return cloneFixture(failureRecords);
    },
    async getSnapshot() {
      return cloneFixture(snapshot);
    },
    async refresh() {
      refreshCount += 1;
      if (refreshFailure) {
        const failure = refreshFailure;
        refreshFailure = null;
        failureRecords = [...failureRecords, { operation: 'refresh', message: failure.message }];
        throw failure;
      }
      if (refreshBarrier) {
        const barrier = refreshBarrier;
        refreshBarrier = null;
        barrier.markStarted();
        await barrier.promise;
      }
      snapshot = { games: copyGames(games), updatedAt: snapshot.updatedAt + 1 };
      return cloneFixture(snapshot);
    },
    async getStreamers(campaignKey) {
      directoryCount += 1;
      if (directoryFailure) {
        const failure = directoryFailure;
        directoryFailure = null;
        failureRecords = [...failureRecords, { operation: 'directory', message: failure.message }];
        throw failure;
      }
      return copyFixtureList(streamersByCampaign.get(campaignKey) ?? []);
    },
    async hasSession() {
      return sessionAvailable;
    },
    setGames(nextGames) {
      games = copyGames(nextGames);
    },
    setStreamers(campaignKey, streamers) {
      streamersByCampaign = new Map(streamersByCampaign).set(campaignKey, copyFixtureList(streamers));
    },
    setSessionAvailable(available) {
      sessionAvailable = available;
    },
    blockNextRefresh() {
      const barrier = createExecutionBarrier<void>();
      refreshBarrier = barrier;
      return barrier;
    },
    failNextRefresh(error) {
      refreshFailure = error;
    },
    failNextDirectory(error) {
      directoryFailure = error;
    },
  };
  return adapter;
}

function copyFixtureList<T>(values: readonly T[]): readonly T[] {
  return values.map((value) => cloneFixture(value));
}
