import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readTwitchSessionViaExecuteScript } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

interface ScriptExecutionMock {
  executeScript: (options: {
    target: { tabId: number };
    func: () => unknown;
  }) => Promise<Array<{ result: unknown }>>;
}

function createScriptExecutionMock(result: unknown): ScriptExecutionMock {
  return {
    executeScript: async () => [{ result }],
  };
}

describe('readTwitchSessionViaExecuteScript', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns null when executeScript returns null result', async () => {
    const execMock = createScriptExecutionMock(null);
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript };

    const result = await readTwitchSessionViaExecuteScript(123);
    expect(result).toBeNull();
  });

  test('returns null when sanitizeTwitchSession rejects the raw result', async () => {
    const execMock = createScriptExecutionMock({ userId: '12345678' });
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript };

    const result = await readTwitchSessionViaExecuteScript(456);
    expect(result).toBeNull();
  });

  test('returns sanitized session from executeScript result', async () => {
    const rawSession = {
      oauthToken: 'oauth12345678901234567890',
      userId: '12345678',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'script-uuid-abc',
      clientIntegrity: 'script-integrity-token',
    };
    const execMock = createScriptExecutionMock(rawSession);
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript };

    const result = await readTwitchSessionViaExecuteScript(789);
    expect(result).not.toBeNull();
    expect(result?.oauthToken).toBe('oauth12345678901234567890');
    expect(result?.userId).toBe('12345678');
    expect(result?.deviceId).toBe('device-abc-12345678901234567');
    expect(result?.clientIntegrity).toBe('script-integrity-token');
  });

  test('returns null when chrome.scripting.executeScript throws', async () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = {
      executeScript: async () => {
        throw new Error('executeScript failed');
      },
    };

    const result = await readTwitchSessionViaExecuteScript(999);
    expect(result).toBeNull();
  });
});
