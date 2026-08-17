import { describe, expect, test } from 'bun:test';
import { createServiceWorkerStarter } from '../src/background/service-worker-runtime-wiring.ts';

describe('service worker composition', () => {
  test('begins initialization before registering handlers and starts only once', () => {
    // Given
    const events: string[] = [];
    const start = createServiceWorkerStarter({
      beginInitialization: async () => {
        events.push('initialization');
      },
      registerBrowserEvents: () => events.push('browser-events'),
      registerRuntime: () => events.push('runtime-handlers'),
      reportInitializationError: () => events.push('initialization-error'),
      reportStarted: () => events.push('started'),
    });

    // When
    start();
    start();

    // Then
    expect(events).toEqual(['initialization', 'browser-events', 'runtime-handlers', 'started']);
  });

  test('keeps initialization failure reporting outside handler registration', async () => {
    // Given
    const expectedError = new Error('initialization failed');
    const reported: unknown[] = [];
    const registrations: string[] = [];
    const start = createServiceWorkerStarter({
      beginInitialization: () => Promise.reject(expectedError),
      registerBrowserEvents: () => registrations.push('browser-events'),
      registerRuntime: () => registrations.push('runtime-handlers'),
      reportInitializationError: (error) => reported.push(error),
      reportStarted: () => registrations.push('started'),
    });

    // When
    start();
    await Promise.resolve();

    // Then
    expect(registrations).toEqual(['browser-events', 'runtime-handlers', 'started']);
    expect(reported).toEqual([expectedError]);
  });
});
