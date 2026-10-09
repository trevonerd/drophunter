import './cases/message-router-01.ts';
import './cases/message-router-02.ts';
import './cases/message-router-03.ts';
import './cases/message-router-04.ts';
import './cases/message-router-05.ts';
import './cases/message-router-06.ts';
import './cases/message-router-07.ts';
import './cases/message-router-08.ts';
import './cases/message-router-09.ts';
import './cases/message-router-10.ts';
import './cases/message-router-11.ts';
import { expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../src/background/message-router.ts';
import { callListener, createHandlers } from './support/message-router-fixtures.ts';

test('routes validated adblock toggles and surfaces registration failures', async () => {
  let calls = 0;
  const listener = createRuntimeMessageListener(
    createHandlers({
      setTwitchAdblockEnabled: async (message) => {
        calls++;
        if (message.payload?.enabled) throw new Error('registration unavailable');
        return { success: true, twitchAdblockEnabled: false };
      },
    }),
  );
  expect(
    (await callListener(listener, { type: 'SET_TWITCH_ADBLOCK_ENABLED', payload: { enabled: false } }))
      .response,
  ).toEqual({ success: true, twitchAdblockEnabled: false });
  expect(
    (await callListener(listener, { type: 'SET_TWITCH_ADBLOCK_ENABLED', payload: { enabled: true } }))
      .response,
  ).toEqual({ success: false, error: 'Error: registration unavailable' });
  expect(
    (await callListener(listener, { type: 'SET_TWITCH_ADBLOCK_ENABLED', payload: { enabled: 'yes' } }))
      .response,
  ).toEqual({ success: false, error: 'Invalid message payload' });
  expect(calls).toBe(2);
});

test('validates blocked ad increments before routing and surfaces persistence failures', async () => {
  const counts: number[] = [];
  const listener = createRuntimeMessageListener(
    createHandlers({
      twitchAdsBlocked: async (message) => {
        counts.push(message.payload.count);
        if (message.payload.count === 3) throw new Error('storage unavailable');
        return { success: true };
      },
    }),
  );
  expect(
    (await callListener(listener, { type: 'TWITCH_ADS_BLOCKED', payload: { count: 2 } })).response,
  ).toEqual({ success: true });
  for (const count of [0, -1, 1.5, '2', Infinity, 10001]) {
    expect(
      (await callListener(listener, { type: 'TWITCH_ADS_BLOCKED', payload: { count } })).response,
    ).toEqual({ success: false, error: 'Invalid message payload' });
  }
  expect(
    (await callListener(listener, { type: 'TWITCH_ADS_BLOCKED', payload: { count: 3 } })).response,
  ).toEqual({ success: false, error: 'Error: storage unavailable' });
  expect(counts).toEqual([2, 3]);
});
