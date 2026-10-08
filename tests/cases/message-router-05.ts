import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('returns async handler results and converts thrown errors into response errors', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        pauseFarming: async () => ({ success: true, paused: true }),
        resumeFarming: async () => {
          throw new Error('resume failed');
        },
      }),
    );

    const pause = await callListener(listener, { type: 'PAUSE_FARMING' });
    const resume = await callListener(listener, { type: 'RESUME_FARMING' });

    expect(pause.response).toEqual({ success: true, paused: true });
    expect(resume.response).toEqual({ success: false, error: 'Error: resume failed' });
  });
});
