import { browser } from './browser-api.ts';
import type { RuntimeRequest, RuntimeResponseByType } from './message-contracts.ts';

export type {
  AddToQueueReason,
  RuntimeMessageType,
  RuntimeRequest,
  RuntimeResponseByType,
} from './message-contracts.ts';
export {
  ADD_TO_QUEUE_REASONS,
  BOOLEAN_TOGGLE_MESSAGES,
  NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES,
  RUNTIME_MESSAGE_TYPES,
} from './message-contracts.ts';
export {
  isRuntimeMessageType,
  isRuntimeRequest,
  validateBooleanTogglePayload,
} from './message-validation.ts';

export async function sendRuntimeMessage<T extends RuntimeRequest['type']>(
  request: Extract<RuntimeRequest, { type: T }>,
): Promise<RuntimeResponseByType[T] | undefined> {
  return (await browser.runtime.sendMessage(request)) as RuntimeResponseByType[T] | undefined;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled runtime message: ${String(value)}`);
}
