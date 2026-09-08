import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationStorageArea } from './farming-automation-contracts.ts';

export function chromeStorageArea(scope: 'local' | 'session'): FarmingAutomationStorageArea {
  return {
    get: (keys) => browser.storage[scope].get([...keys]),
    set: (values) => browser.storage[scope].set(values),
    remove: (keys) => browser.storage[scope].remove([...keys]),
  };
}

export class InMemoryFarmingAutomationStorage {
  readonly local: FarmingAutomationStorageArea;
  readonly session: FarmingAutomationStorageArea;
  private readonly localValues = new Map<string, unknown>();
  private readonly sessionValues = new Map<string, unknown>();
  private readonly localSetPayloads: Readonly<Record<string, unknown>>[] = [];
  private localWriteFailuresRemaining = 0;

  constructor() {
    this.local = this.createArea(this.localValues, 'local');
    this.session = this.createArea(this.sessionValues, 'session');
  }

  seedLocal(key: string, value: unknown): void {
    this.localValues.set(key, structuredClone(value));
  }

  getLocal(key: string): unknown {
    return structuredClone(this.localValues.get(key));
  }

  getLocalSetPayloads(): readonly Readonly<Record<string, unknown>>[] {
    return structuredClone(this.localSetPayloads);
  }

  failNextLocalSet(): void {
    this.localWriteFailuresRemaining += 1;
  }

  restartBrowser(): void {
    this.sessionValues.clear();
  }

  private createArea(values: Map<string, unknown>, scope: 'local' | 'session'): FarmingAutomationStorageArea {
    return {
      get: async (keys) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (values.has(key)) result[key] = structuredClone(values.get(key));
        }
        return result;
      },
      set: async (items) => {
        if (scope === 'local' && this.localWriteFailuresRemaining > 0) {
          this.localWriteFailuresRemaining -= 1;
          throw new DOMException('Injected local storage failure', 'InMemoryStorageWriteError');
        }
        if (scope === 'local') this.localSetPayloads.push(structuredClone(items));
        for (const [key, value] of Object.entries(items)) {
          values.set(key, structuredClone(value));
        }
      },
      remove: async (keys) => {
        for (const key of keys) values.delete(key);
      },
    };
  }
}

export function createInMemoryFarmingAutomationStorage(): InMemoryFarmingAutomationStorage {
  return new InMemoryFarmingAutomationStorage();
}
