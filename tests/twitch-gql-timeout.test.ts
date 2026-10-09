import { afterEach, expect, test } from 'bun:test';
import { classifyTwitchApiFailure } from '../src/background/twitch-api/errors.ts';
import { fetchTwitchIntegrityToken, TwitchGqlTransport } from '../src/background/twitch-api/gql.ts';
import { validSession } from './support/session-management-fixtures.ts';

const nativeFetch = globalThis.fetch;
const nativeTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = nativeFetch;
  globalThis.setTimeout = nativeTimeout;
});

const requests = [
  ['public', () => new TwitchGqlTransport(validSession()).post({})],
  ['authorized', () => new TwitchGqlTransport(validSession()).postAuthorized({})],
  ['batch', () => new TwitchGqlTransport(validSession()).postAuthorizedBatch([{}])],
  ['integrity', () => fetchTwitchIntegrityToken(validSession())],
] as const;

test.each(requests)(
  '%s requests time out when headers arrive but the JSON body stalls',
  async (_name, request) => {
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      nativeTimeout(handler, delay === 20_000 ? 5 : delay, ...args)) as typeof setTimeout;
    let cleanup = () => {};
    globalThis.fetch = async (_input, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            cleanup = () => controller.error(new Error('Test cleanup'));
            controller.enqueue(new TextEncoder().encode('{'));
            init?.signal?.addEventListener(
              'abort',
              () => {
                controller.error(new DOMException('Request aborted', 'AbortError'));
              },
              { once: true },
            );
          },
        }),
      );
    try {
      const outcome = await Promise.race([
        request().catch((error: unknown) => error),
        new Promise<null>((resolve) => nativeTimeout(() => resolve(null), 50)),
      ]);
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toMatchObject({ message: 'Twitch GQL request timed out.' });
    } finally {
      cleanup();
    }
  },
);

test.each(requests)(
  '%s requests classify HTTP errors without waiting for an unfinished body',
  async (_name, request) => {
    let cleanup = () => {};
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            cleanup = () => controller.error(new Error('Test cleanup'));
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
        { status: 429, headers: { 'Retry-After': '90' } },
      );
    try {
      const outcome = await Promise.race([
        request().catch((error: unknown) => error),
        new Promise<null>((resolve) => nativeTimeout(() => resolve(null), 50)),
      ]);
      expect(classifyTwitchApiFailure(outcome)).toMatchObject({ kind: 'rate-limit', retryAfterMs: 90_000 });
    } finally {
      cleanup();
    }
  },
);
