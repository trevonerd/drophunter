const KEEPALIVE_DATASET_KEY = 'drophunterKeepalive';

function active(): boolean {
  return document.documentElement?.dataset[KEEPALIVE_DATASET_KEY] === '1';
}

function overrideDocumentState(property: string, value: unknown): void {
  const descriptor =
    Object.getOwnPropertyDescriptor(Document.prototype, property) ??
    Object.getOwnPropertyDescriptor(document, property);
  if (!descriptor?.get) return;
  Object.defineProperty(document, property, {
    configurable: true,
    get() {
      return active() ? value : descriptor.get?.call(this);
    },
  });
}

export function startPlaybackKeepalive(): void {
  overrideDocumentState('hidden', false);
  overrideDocumentState('visibilityState', 'visible');
  overrideDocumentState('webkitHidden', false);
  overrideDocumentState('webkitVisibilityState', 'visible');

  const realHasFocus = document.hasFocus.bind(document);
  document.hasFocus = () => (active() ? true : realHasFocus());

  const swallowManagedVisibility = (event: Event) => {
    if (active()) event.stopImmediatePropagation();
  };
  document.addEventListener('visibilitychange', swallowManagedVisibility, true);
  document.addEventListener('webkitvisibilitychange', swallowManagedVisibility, true);
  window.addEventListener('blur', swallowManagedVisibility, true);
  window.addEventListener('pagehide', swallowManagedVisibility, true);
}
