import type { ScriptInjection, ScriptInjectionResult } from './chrome-types.ts';

export function createManagedMarkerScriptMock() {
  const markers = new Map<number, readonly unknown[]>();
  return async (options: ScriptInjection): Promise<ScriptInjectionResult[]> => {
    if (options.func.name === 'writeManagedWatchMarkerInPage') {
      markers.set(options.target.tabId, options.args ?? []);
      return [{ frameId: 0, result: true }];
    }
    if (options.func.name === 'readManagedWatchMarkerInPage') {
      return [
        {
          frameId: 0,
          result: JSON.stringify(markers.get(options.target.tabId)) === JSON.stringify(options.args),
        },
      ];
    }
    return [];
  };
}
