import type { ServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';

export function createTabManagementState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return { ...createServiceWorkerState(), ...overrides };
}
