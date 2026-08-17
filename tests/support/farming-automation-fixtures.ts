import type { TwitchGame } from '../../src/types/index.ts';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise(value),
    reject: (reason) => rejectPromise(reason),
  };
}

export interface Barrier<T = void> extends Deferred<T> {
  readonly release: (value: T) => void;
}

export function createBarrier<T = void>(defaultValue: T): Barrier<T> {
  const deferred = createDeferred<T>();
  return { ...deferred, release: (value = defaultValue) => deferred.resolve(value) };
}

export interface ExecutionBarrier<T = void> {
  readonly started: Promise<void>;
  readonly promise: Promise<T>;
  readonly markStarted: () => void;
  readonly release: (value: T) => void;
}

export function createExecutionBarrier<T>(): ExecutionBarrier<T> {
  const started = createDeferred<void>();
  const completion = createDeferred<T>();
  return {
    started: started.promise,
    promise: completion.promise,
    markStarted: () => started.resolve(undefined),
    release: (value) => completion.resolve(value),
  };
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

export interface TestClock {
  readonly now: () => number;
  readonly set: (value: number) => void;
  readonly advance: (deltaMs: number) => number;
}

export function createTestClock(initial = 0): TestClock {
  let current = initial;
  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
    advance: (deltaMs) => {
      current += deltaMs;
      return current;
    },
  };
}

export function createCampaignFixture(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Game 1',
    displayName: 'Game 1',
    imageUrl: '',
    campaignId: 'campaign-1',
    categoryId: 'category-1',
    categorySlug: 'game-1',
    endsAt: '2026-08-18T00:00:00.000Z',
    dropCount: 1,
    ...overrides,
  };
}

export function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}
