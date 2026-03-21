import type { AppState, Message } from '../types/index.ts';
import { createInitialState } from './utils.ts';

export function normalizeStoredAppState(value: unknown): AppState {
  if (!value || typeof value !== 'object') {
    return createInitialState();
  }
  return {
    ...createInitialState(),
    ...(value as Partial<AppState>),
  };
}

export async function loadStoredAppState(): Promise<AppState> {
  const result = await chrome.storage.local.get(['appState']);
  return normalizeStoredAppState(result.appState);
}

export function subscribeToAppState(onState: (state: AppState) => void): () => void {
  const runtimeListener = (message: Message) => {
    if (message.type === 'UPDATE_STATE' && message.payload) {
      onState(normalizeStoredAppState(message.payload));
    }
  };

  const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
    if (areaName !== 'local' || !changes.appState) {
      return;
    }
    onState(normalizeStoredAppState(changes.appState.newValue));
  };

  chrome.runtime.onMessage.addListener(runtimeListener);
  chrome.storage.onChanged.addListener(storageListener);

  return () => {
    chrome.runtime.onMessage.removeListener(runtimeListener);
    chrome.storage.onChanged.removeListener(storageListener);
  };
}
