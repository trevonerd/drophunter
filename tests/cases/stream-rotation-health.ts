import { expect, test } from 'bun:test';
import {
  classifyStreamHealth,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  MAX_PERSISTENT_RECOVERY_CYCLES,
} from '../../src/background/stream-rotation.ts';

export function registerStreamHealthCases() {
  test('healthy live stream with matching game and drops signal does not request recovery', () => {
    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: true,
        progressStalled: false,
        expectsDropsSignal: true,
      }),
    ).toEqual({
      isHealthy: true,
      forceImmediateRotation: false,
      invalidIncrement: 0,
      reason: null,
    });
  });

  test('wrong game requests a non-stall recovery', () => {
    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: false,
        hasDropsSignal: true,
        progressStalled: false,
        expectsDropsSignal: true,
      }),
    ).toEqual({
      isHealthy: false,
      forceImmediateRotation: false,
      invalidIncrement: 2,
      reason: 'wrong-game',
    });
  });

  test('missing drops signal requests a slow recovery only when drops are expected', () => {
    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: false,
        progressStalled: false,
        expectsDropsSignal: true,
      }),
    ).toEqual({
      isHealthy: false,
      forceImmediateRotation: false,
      invalidIncrement: 1,
      reason: 'drops-inactive',
    });

    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: false,
        progressStalled: false,
        expectsDropsSignal: false,
      }),
    ).toEqual({
      isHealthy: true,
      forceImmediateRotation: false,
      invalidIncrement: 0,
      reason: null,
    });
  });

  test('offline stream requests recovery', () => {
    expect(
      classifyStreamHealth({
        isLive: false,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: true,
        progressStalled: false,
        expectsDropsSignal: true,
      }),
    ).toEqual({
      isHealthy: false,
      forceImmediateRotation: true,
      invalidIncrement: 0,
      reason: 'offline',
    });
  });

  test('stalled progress requests immediate recovery', () => {
    const result = classifyStreamHealth({
      isLive: true,
      sameChannel: true,
      sameGame: true,
      hasDropsSignal: true,
      progressStalled: true,
      expectsDropsSignal: true,
    });

    expect(result.isHealthy).toBe(false);
    expect(result.forceImmediateRotation).toBe(false);
    expect(result.reason).toBe('stalled-progress');
    expect(result.invalidIncrement).toBeGreaterThan(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
  });

  test('persistent recovery cycle cap exceeds the rotation attempt cap', () => {
    expect(MAX_PERSISTENT_RECOVERY_CYCLES).toBeGreaterThan(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
  });

  test('stream is classified healthy when no drops are expected and no drops signal present (campaign-vanished scenario)', () => {
    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: false,
        progressStalled: false,
        expectsDropsSignal: false,
      }),
    ).toEqual({
      isHealthy: true,
      forceImmediateRotation: false,
      invalidIncrement: 0,
      reason: null,
    });
  });

  test('stream with drops expected but no drops signal is unhealthy with drops-inactive', () => {
    expect(
      classifyStreamHealth({
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: false,
        progressStalled: false,
        expectsDropsSignal: true,
      }),
    ).toEqual({
      isHealthy: false,
      forceImmediateRotation: false,
      invalidIncrement: 1,
      reason: 'drops-inactive',
    });
  });
}
