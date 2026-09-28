import { describe, expect, test } from 'bun:test';
import { runFarmingControlRequest } from '../src/popup/hooks/farming-control-action.ts';

describe('popup farming controls', () => {
  test.each([
    ['PAUSE_FARMING', 'pause'],
    ['RESUME_FARMING', 'resume'],
    ['STOP_FARMING', 'stop'],
  ] as const)('surfaces %s response errors', async (type, verb) => {
    const error = await runFarmingControlRequest(type, async () => ({
      success: false,
      error: `${verb} persistence failed`,
    }));

    expect(error).toBe(`${verb} persistence failed`);
  });

  test.each([
    ['PAUSE_FARMING', 'Unable to pause farming.'],
    ['RESUME_FARMING', 'Unable to resume farming.'],
    ['STOP_FARMING', 'Unable to stop farming.'],
  ] as const)('turns %s transport failures into accessible feedback', async (type, expected) => {
    const error = await runFarmingControlRequest(type, async () => {
      throw new Error('disconnected');
    });

    expect(error).toBe(expected);
  });

  test('returns no message after a successful control action', async () => {
    expect(await runFarmingControlRequest('PAUSE_FARMING', async () => ({ success: true }))).toBeNull();
  });
});
