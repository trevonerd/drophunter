import type { ListenerMock, MessageHandler, MessageListenerMock } from './chrome-types.ts';

export function createListenerMock<T>(): ListenerMock<T> {
  const handlers: Array<(arg: T) => void> = [];
  return {
    _handlers: handlers,
    addListener(handler) {
      handlers.push(handler);
    },
    removeListener(handler) {
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    },
    trigger(arg) {
      for (const handler of handlers) handler(arg);
    },
  };
}

export function createMessageListenerMock(): MessageListenerMock {
  const handlers: MessageHandler[] = [];
  return {
    _handlers: handlers,
    addListener(handler) {
      handlers.push(handler);
    },
    removeListener(handler) {
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    },
    trigger(message, sender = {}) {
      for (const handler of handlers) handler(message, sender, () => {});
    },
  };
}
