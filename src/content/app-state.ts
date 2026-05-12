type ContentAppState = {
  autoClaimChannelPointsBonus?: boolean;
};

type RuntimeListener = (message: unknown) => void;
type StorageChange = { newValue?: unknown };
type StorageListener = (changes: Record<string, StorageChange>, areaName: string) => void;

type ContentChromeApi = {
  runtime?: {
    onMessage?: {
      addListener(listener: RuntimeListener): void;
      removeListener(listener: RuntimeListener): void;
    };
  };
  storage?: {
    local?: {
      get(keys: string[]): Promise<Record<string, unknown>>;
    };
    onChanged?: {
      addListener(listener: StorageListener): void;
      removeListener(listener: StorageListener): void;
    };
  };
};

function getChromeApi(): ContentChromeApi | null {
  try {
    return typeof chrome === 'undefined' ? null : (chrome as ContentChromeApi);
  } catch {
    return null;
  }
}

export function normalizeContentAppState(value: unknown): ContentAppState {
  if (!value || typeof value !== 'object') {
    return { autoClaimChannelPointsBonus: true };
  }
  return {
    autoClaimChannelPointsBonus: true,
    ...(value as ContentAppState),
  };
}

export async function loadStoredContentAppState(): Promise<ContentAppState> {
  const storageLocal = getChromeApi()?.storage?.local;
  if (!storageLocal) {
    return normalizeContentAppState(null);
  }

  const result = await storageLocal.get(['appState']);
  return normalizeContentAppState(result.appState);
}

export function subscribeToContentAppState(onState: (state: ContentAppState) => void): () => void {
  const runtimeListener: RuntimeListener = (message) => {
    if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'UPDATE_STATE') {
      return;
    }
    const updateMessage = message as { payload?: unknown };
    if (updateMessage.payload) {
      onState(normalizeContentAppState(updateMessage.payload));
    }
  };

  const storageListener: StorageListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes.appState) {
      return;
    }
    onState(normalizeContentAppState(changes.appState.newValue));
  };

  const chromeApi = getChromeApi();
  const runtimeOnMessage = chromeApi?.runtime?.onMessage;
  const storageOnChanged = chromeApi?.storage?.onChanged;

  runtimeOnMessage?.addListener(runtimeListener);
  storageOnChanged?.addListener(storageListener);

  return () => {
    runtimeOnMessage?.removeListener(runtimeListener);
    storageOnChanged?.removeListener(storageListener);
  };
}
